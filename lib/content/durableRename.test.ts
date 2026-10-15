import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renameDurably, retryWhileLocked } from "./durableRename";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mi-durable-rename-"));
}

function lockError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renameDurably", () => {
  it("moves a file the ordinary way when nothing is holding it", () => {
    const root = tempRoot();
    const source = path.join(root, "event.json.tmp");
    const target = path.join(root, "event.json");
    fs.writeFileSync(source, "{}\n");

    expect(renameDurably(source, target)).toEqual({ strategy: "rename" });
    expect(fs.readFileSync(target, "utf8")).toBe("{}\n");
    expect(fs.existsSync(source)).toBe(false);
  });

  it("retries the EPERM Dropbox reports while it still has the temp file open", () => {
    const root = tempRoot();
    const source = path.join(root, "event.json.tmp");
    const target = path.join(root, "event.json");
    fs.writeFileSync(source, "{}\n");

    const real = fs.renameSync;
    let attempts = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      attempts += 1;
      if (attempts < 3) throw lockError("EPERM");
      return real(from, to);
    });

    expect(renameDurably(source, target)).toEqual({ strategy: "rename" });
    expect(attempts).toBe(3);
    expect(fs.readFileSync(target, "utf8")).toBe("{}\n");
  });

  it("falls back to copying when the rename never stops failing", () => {
    // The realistic shape of the shipped bug: Dropbox holds the source open for indexing, so
    // the move can never take delete access on it, but reading it to copy still works.
    const root = tempRoot();
    const source = path.join(root, "event.json.tmp");
    const target = path.join(root, "event.json");
    fs.writeFileSync(source, '{"phase":"complete"}\n');
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (from === source) throw lockError("EPERM"); return rename(from, to); });

    expect(renameDurably(source, target)).toEqual({ strategy: "copy" });
    expect(fs.readFileSync(target, "utf8")).toBe('{"phase":"complete"}\n');
  });

  it("keeps the content when even the temp file cannot be deleted afterwards", () => {
    const root = tempRoot();
    const source = path.join(root, "event.json.tmp");
    const target = path.join(root, "event.json");
    fs.writeFileSync(source, "kept\n");
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (from === source) throw lockError("EBUSY"); return rename(from, to); });
    vi.spyOn(fs, "rmSync").mockImplementation(() => { throw lockError("EPERM"); });

    expect(renameDurably(source, target)).toEqual({ strategy: "copy" });
    expect(fs.readFileSync(target, "utf8")).toBe("kept\n");
  });

  it("explains a lock it could not work around instead of leaking the raw errno", () => {
    const root = tempRoot();
    const source = path.join(root, "event.json.tmp");
    const target = path.join(root, "event.json");
    fs.writeFileSync(source, "{}\n");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw lockError("EPERM"); });
    vi.spyOn(fs, "copyFileSync").mockImplementation(() => { throw lockError("EPERM"); });

    expect(() => renameDurably(source, target)).toThrow(/EPERM/);
  });

  it("never copies a directory into place -- a half-copied tree is worse than a clear failure", () => {
    const root = tempRoot();
    const source = path.join(root, "staged-collection");
    const target = path.join(root, "collection");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "collection.yaml"), "name: x\n");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw lockError("EPERM"); });
    const copy = vi.spyOn(fs, "copyFileSync");

    expect(() => renameDurably(source, target)).toThrow(/Dropbox syncing or antivirus/);
    expect(copy).not.toHaveBeenCalled();
    expect(fs.existsSync(target)).toBe(false);
  });

  it("reports a real problem immediately rather than retrying it for a second", () => {
    const root = tempRoot();
    const missing = path.join(root, "not-there.tmp");
    const started = Date.now();
    expect(() => renameDurably(missing, path.join(root, "target.json"))).toThrow(/ENOENT/);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("retryWhileLocked", () => {
  it("gives a locked operation several chances and then returns its value", () => {
    let calls = 0;
    const value = retryWhileLocked(() => {
      calls += 1;
      if (calls < 4) throw lockError("EACCES");
      return "done";
    });
    expect(value).toBe("done");
    expect(calls).toBe(4);
  });

  it("does not retry an error that is not a transient lock", () => {
    let calls = 0;
    expect(() => retryWhileLocked(() => {
      calls += 1;
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    })).toThrow(/ENOSPC/);
    expect(calls).toBe(1);
  });
});
