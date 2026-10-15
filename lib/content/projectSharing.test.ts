import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

let root: string, local: string, dropbox: string;
let meta: { name: string; dropbox_path: string | null; content_location: string };
vi.mock("./projects", () => ({ getProjectSlugs: () => ["fixture"], getProject: () => ({ slug: "fixture", meta }), contentDir: () => local }));
vi.mock("./paths", () => ({ get DROPBOX_ROOT() { return dropbox; } }));
import { readProjectDiscovery, readProjectPdfIndex, guardedPath, invalidateProjectDiscovery } from "./projectDiscovery";
import { previewProjectPdf, saveProjectPdf, previewProjectHandoff, saveProjectHandoff } from "./projectSharing";
import { hashContent } from "./atomicContentWrite";

beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mi-sharing-")));
  local = path.join(root, "local"); dropbox = path.join(root, "dropbox");
  fs.mkdirSync(local); fs.mkdirSync(path.join(dropbox, "partner-project"), { recursive: true });
  meta = { name: "Fixture", dropbox_path: "partner-project", content_location: "local" };
  invalidateProjectDiscovery("fixture");
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); invalidateProjectDiscovery("fixture"); });
const pdf = Buffer.from("%PDF-1.7\nfixture");
const draft = () => ({ id: randomUUID(), title: "Facade study", summary: "Prepared alternatives; client selection pending.", nextSteps: "Review options", openQuestions: "Which glazing?", author: "Partner", provider: "claude", files: [] });

describe("reviewed project sharing", () => {
  it("finds newly synced partner PDFs without reading their bytes or poisoning revision checks", async () => {
    const folder = path.join(dropbox, "partner-project");
    fs.writeFileSync(path.join(folder, "partner.pdf"), pdf);
    fs.writeFileSync(path.join(folder, "token-private.pdf"), pdf);
    fs.writeFileSync(path.join(folder, "other.txt"), "not a PDF");
    fs.symlinkSync(local, path.join(folder, "linked"), "junction");
    fs.writeFileSync(path.join(local, "local.pdf"), pdf);
    const read = vi.spyOn(fs.promises, "readFile");
    try {
      const result = await readProjectPdfIndex("fixture");
      expect(result.files.map(file => file.name).sort()).toEqual(["local.pdf", "partner.pdf"]);
      expect(result.complete).toBe(true);
      expect(read).not.toHaveBeenCalled();
      fs.writeFileSync(path.join(folder, "new.pdf"), pdf);
      expect((await readProjectPdfIndex("fixture")).files).toHaveLength(3);
    } finally { read.mockRestore(); }
    expect((await readProjectDiscovery("fixture")).files.filter(file => file.name.endsWith(".pdf")).every(file => file.revision === hashContent(pdf))).toBe(true);
  });
  it("requires exact confirmation, discovers generic PDFs, and never overwrites another file", async () => {
    const preview = previewProjectPdf("fixture", "study.pdf", pdf);
    expect(fs.existsSync(path.join(dropbox, "partner-project", "Mi"))).toBe(false);
    expect(() => saveProjectPdf("fixture", "study.pdf", pdf, preview.fingerprint, false)).toThrow(/confirm/);
    expect(() => saveProjectPdf("fixture", "study.pdf", Buffer.from("%PDF-changed"), preview.fingerprint, true)).toThrow(/changed/);
    saveProjectPdf("fixture", "study.pdf", pdf, preview.fingerprint, true);
    const result = await readProjectDiscovery("fixture");
    expect(result.files[0]).toMatchObject({ name: "study.pdf", path: "Mi/outputs/study.pdf", source: "dropbox", revision: hashContent(pdf), output: true });
    expect(() => previewProjectPdf("fixture", "study.pdf", Buffer.from("%PDF-different"))).toThrow(/different file/);
    expect(saveProjectPdf("fixture", "study.pdf", pdf, preview.fingerprint, true).alreadySaved).toBe(true);
  });
  it("binds reviewed destinations and rejects changed folder mappings", () => {
    const preview = previewProjectPdf("fixture", "study.pdf", pdf);
    fs.mkdirSync(path.join(dropbox, "different")); meta.dropbox_path = "different";
    expect(() => saveProjectPdf("fixture", "study.pdf", pdf, preview.fingerprint, true)).toThrow(/changed/);
  });
  it("publishes immutable handoffs with current file references and idempotent retry", async () => {
    const p = previewProjectPdf("fixture", "study.pdf", pdf); saveProjectPdf("fixture", "study.pdf", pdf, p.fingerprint, true);
    const value = { ...draft(), files: [{ source: "dropbox", path: "Mi/outputs/study.pdf", revision: hashContent(pdf) }] };
    const preview = previewProjectHandoff("fixture", value);
    expect(() => saveProjectHandoff("fixture", value, preview.fingerprint, false)).toThrow(/confirm/);
    const saved = saveProjectHandoff("fixture", value, preview.fingerprint, true);
    expect(saveProjectHandoff("fixture", value, preview.fingerprint, true)).toEqual(saved);
    const second = draft(); const next = previewProjectHandoff("fixture", second); saveProjectHandoff("fixture", second, next.fingerprint, true);
    expect((await readProjectDiscovery("fixture", true)).handoffs).toHaveLength(2);
    fs.writeFileSync(path.join(dropbox, "partner-project", "Mi", "outputs", "study.pdf"), "%PDF-changed");
    expect(() => saveProjectHandoff("fixture", value, preview.fingerprint, true)).toThrow(/file changed/);
  });
  it("hashes content rather than treating a timestamp change as new work", async () => {
    const file = path.join(dropbox, "partner-project", "generic.pdf"); fs.writeFileSync(file, pdf);
    const first = await readProjectDiscovery("fixture"); fs.utimesSync(file, new Date(), new Date());
    const second = await readProjectDiscovery("fixture", true);
    expect(first.files[0].revision).toBe(second.files[0].revision);
  });
  it("fails closed on unavailable shared roots, traversal, hidden files, and junctions", async () => {
    for (const relative of ["../escape.pdf", "C:/escape.pdf", ".env.local", "secrets/private.txt", "Mi/outputs/../escape.pdf"]) expect(() => guardedPath(dropbox, relative)).toThrow();
    fs.symlinkSync(local, path.join(dropbox, "partner-project", "linked"), "junction");
    expect(() => guardedPath(path.join(dropbox, "partner-project"), "linked/file.pdf")).toThrow(/Linked/);
    fs.writeFileSync(path.join(dropbox, "partner-project", ".private.pdf"), pdf);
    expect((await readProjectDiscovery("fixture")).files).toHaveLength(0);
    meta.dropbox_path = "unavailable";
    await expect(readProjectDiscovery("fixture", true)).rejects.toThrow(/unavailable/);
  });
  it("supports explicitly local projects without claiming partner sharing", async () => {
    meta.dropbox_path = null;
    const preview = previewProjectPdf("fixture", "local.pdf", pdf); expect(preview.shared).toBe(false);
    saveProjectPdf("fixture", "local.pdf", pdf, preview.fingerprint, true);
    expect((await readProjectDiscovery("fixture")).files[0].path).toBe("outputs/local.pdf");
  });
  it("keeps bounded metadata revisions and their limitations stable across scans", async () => {
    const file = path.join(dropbox, "partner-project", "large.pdf");
    const fd = fs.openSync(file, "wx"); fs.ftruncateSync(fd, 33 * 1024 * 1024); fs.closeSync(fd);
    const first = await readProjectDiscovery("fixture", true);
    const second = await readProjectDiscovery("fixture", true);
    expect(first.files[0].revision).toMatch(/^metadata:/);
    expect(second.files[0].revision).toBe(first.files[0].revision);
    expect(second.warnings).toEqual(first.warnings);
    expect(second.complete).toBe(false);
  });
});
