import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { applyDropboxReview, downloadDropboxReview, healthPath, readDropboxHealth, reviewDropboxFile } from "./dropboxHealth";
import { fileDigest, preserveRecovery } from "./recoveryRecord";
import { renameDurably } from "./durableRename";

let root: string;
beforeEach(() => { root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mi-health-"))); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
const write = (name: string, bytes: string) => { const file = path.join(root, name); fs.writeFileSync(file, bytes); return file; };

describe("Dropbox health and exact reviewed recovery", () => {
  it("distinguishes empty, available, unavailable and cached state without claiming cloud sync", async () => {
    expect(await readDropboxHealth(root)).toMatchObject({ state: "available", nodes: [], cloudSync: "unverified" });
    write("document.pdf", "%PDF-fixture");
    const health = await readDropboxHealth(root, true);
    expect(health.nodes[0].name).toBe("document.pdf");
    expect((await readDropboxHealth(root)).cached).toBe(true);
    const moved = `${root}-away`;
    fs.renameSync(root, moved);
    try { expect(await readDropboxHealth(root, true)).toMatchObject({ state: "unavailable", cached: true, nodes: health.nodes }); }
    finally { fs.renameSync(moved, root); }
  });
  it("returns promptly while one deduplicated async scan is slow", async () => {
    const real = fsp.readdir;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(fsp, "readdir").mockImplementation(async (...args: Parameters<typeof fsp.readdir>) => { await gate; return real(...args); });
    expect((await readDropboxHealth(root, true, 10)).state).toBe("checking");
    expect((await readDropboxHealth(root, true, 10)).state).toBe("checking");
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    expect((await readDropboxHealth(root, true, 1000)).state).toBe("available");
  });
  it("compares and replaces a conflicted copy only after exact review, retains both and backs up", async () => {
    const target = write("notes.txt", "Original");
    const copy = "notes (Partner's conflicted copy 2026-10-10).txt";
    write(copy, "Proposed");
    expect((await readDropboxHealth(root)).conflicts).toEqual([{ path: copy, original: "notes.txt" }]);
    const review = await reviewDropboxFile(root, "conflict", copy);
    expect(review).toMatchObject({ canApply: true, currentText: "Original", proposedText: "Proposed" });
    write("notes.txt", "Newer version");
    await expect(applyDropboxReview(root, review)).rejects.toThrow(/changed/);
    expect(fs.readFileSync(target, "utf8")).toBe("Newer version");
    await applyDropboxReview(root, await reviewDropboxFile(root, "conflict", copy));
    expect(fs.readFileSync(target, "utf8")).toBe("Proposed");
    expect(fs.readFileSync(path.join(root, copy), "utf8")).toBe("Proposed");
    expect(fs.readFileSync(path.join(root, ".mi-backups", fs.readdirSync(path.join(root, ".mi-backups"))[0]), "utf8")).toBe("Newer version");
  });
  it("retains independent recovery through restart/source deletion and refuses changed destinations", async () => {
    const target = write("notes.txt", "Before"), source = write("notes.tmp", "After");
    const manifest = preserveRecovery(source, target, fileDigest(target));
    fs.rmSync(source);
    const relative = path.relative(root, manifest).replaceAll("\\", "/");
    expect((await readDropboxHealth(root)).recoveries).toHaveLength(1);
    write("notes.txt", "Partner update");
    expect(await reviewDropboxFile(root, "recovery", relative)).toMatchObject({ canApply: false });
    write("notes.txt", "Before");
    await applyDropboxReview(root, await reviewDropboxFile(root, "recovery", relative));
    expect(fs.readFileSync(target, "utf8")).toBe("After");
    expect((await readDropboxHealth(root, true)).recoveries).toHaveLength(0);
    write("notes.txt", "Later update");
    expect((await readDropboxHealth(root, true)).recoveries).toHaveLength(0);
  });
  it("rejects tampered payloads, traversal, hidden targets and escaping junctions", async () => {
    const source = write("source.tmp", "After"), target = write("notes.txt", "Before");
    const manifest = preserveRecovery(source, target, fileDigest(target));
    const relative = path.relative(root, manifest).replaceAll("\\", "/");
    fs.writeFileSync(manifest.replace(/\.json$/, ".payload"), "Tampered");
    await expect(reviewDropboxFile(root, "recovery", relative)).rejects.toThrow(/integrity/);
    fs.symlinkSync(os.tmpdir(), path.join(root, "outside"), "junction");
    for (const unsafe of ["../outside", "outside/file", "notes.txt:stream", ".env", "CON.txt"]) await expect(healthPath(root, unsafe)).rejects.toThrow();
    const record = JSON.parse(fs.readFileSync(manifest, "utf8"));
    fs.writeFileSync(manifest, JSON.stringify({ ...record, target: "../outside" }));
    await expect(reviewDropboxFile(root, "recovery", relative)).rejects.toThrow();
  });
  it("downloads exact binary review bytes and refuses a changed proposal", async () => {
    write("drawing.pdf", "%PDF-Old\0");
    const copy = "drawing (conflicted copy).pdf";
    write(copy, "%PDF-New\0");
    const reviewed = await reviewDropboxFile(root, "conflict", copy);
    expect(reviewed.proposedText).toContain("Binary file");
    expect((await downloadDropboxReview(root, reviewed, "proposed")).toString()).toBe("%PDF-New\0");
    write(copy, "%PDF-Changed\0");
    await expect(downloadDropboxReview(root, reviewed, "proposed")).rejects.toThrow(/changed/);
    await expect(applyDropboxReview(root, reviewed)).rejects.toThrow(/changed/);
  });
  it("reports a completed save honestly when its receipt cannot be written", async () => {
    const target = write("notes.txt", "Before"), source = write("source.tmp", "After");
    const manifest = preserveRecovery(source, target, fileDigest(target));
    const relative = path.relative(root, manifest).replaceAll("\\", "/");
    const review = await reviewDropboxFile(root, "recovery", relative);
    vi.spyOn(fsp, "writeFile").mockRejectedValue(Object.assign(new Error("Receipt disk full"), { code: "ENOSPC" }));
    await expect(applyDropboxReview(root, review)).resolves.toBeUndefined();
    expect(fs.readFileSync(target, "utf8")).toBe("After");
  });
});

describe.each([
  ["server", renameDurably],
  ["desktop", createRequire(import.meta.url)("../../electron/durableRename.js").renameDurably as typeof renameDurably],
])("%s save interruption protection", (_label, rename) => {
  it("never copies over the live destination and preserves payload and preimage when all renames fail", async () => {
    const source = write("notes.tmp", "After"), target = write("notes.txt", "Before");
    vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw Object.assign(new Error("locked"), { code: "EPERM" }); });
    const copy = vi.spyOn(fs, "copyFileSync");
    expect(() => rename(source, target)).toThrow(/pending save/);
    expect(copy.mock.calls.every(([, to]) => to !== target)).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("Before");
    const health = await readDropboxHealth(root, true);
    expect(health.recoveries).toHaveLength(1);
    expect(await reviewDropboxFile(root, "recovery", health.recoveries[0].path)).toMatchObject({ currentText: "Before", proposedText: "After", canApply: true });
  });
});
