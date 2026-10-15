import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentConflictError, hashContent, readCurrentHash, writeFileAtomically } from "./atomicContentWrite";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-atomic-write-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("writeFileAtomically", () => {
  it("creates a new file and its parent directory", () => {
    const root = temporaryRoot();
    const target = path.join(root, "nested", "schedule.yaml");
    const result = writeFileAtomically(target, "milestones: []\n");
    expect(fs.readFileSync(target, "utf8")).toBe("milestones: []\n");
    expect(result.backupPath).toBeNull();
  });

  it("updates an existing file and backs up the previous content", () => {
    const root = temporaryRoot();
    const target = path.join(root, "details.yaml");
    writeFileAtomically(target, "version: 1\n");
    const result = writeFileAtomically(target, "version: 2\n");
    expect(fs.readFileSync(target, "utf8")).toBe("version: 2\n");
    expect(result.backupPath).not.toBeNull();
    expect(fs.readFileSync(result.backupPath as string, "utf8")).toBe("version: 1\n");
  });

  it("never leaves a stray .tmp file behind after a normal write", () => {
    const root = temporaryRoot();
    const target = path.join(root, "notes.md");
    writeFileAtomically(target, "# Notes\n");
    const leftovers = fs.readdirSync(root).filter((name) => name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("refuses to write when expectedHash no longer matches the current file", () => {
    const root = temporaryRoot();
    const target = path.join(root, "schedule.yaml");
    writeFileAtomically(target, "milestones: []\n");
    const staleHash = hashContent("a stale read from before someone else's write\n");
    expect(() => writeFileAtomically(target, "milestones: [new]\n", { expectedHash: staleHash }))
      .toThrow(ContentConflictError);
    expect(fs.readFileSync(target, "utf8")).toBe("milestones: []\n");
  });

  it("writes successfully when expectedHash matches the current file", () => {
    const root = temporaryRoot();
    const target = path.join(root, "schedule.yaml");
    writeFileAtomically(target, "milestones: []\n");
    const currentHash = readCurrentHash(target);
    writeFileAtomically(target, "milestones: [new]\n", { expectedHash: currentHash });
    expect(fs.readFileSync(target, "utf8")).toBe("milestones: [new]\n");
  });

  it("treats expectedHash: null as \"must not already exist\"", () => {
    const root = temporaryRoot();
    const target = path.join(root, "fresh.yaml");
    writeFileAtomically(target, "a: 1\n", { expectedHash: null });
    expect(() => writeFileAtomically(target, "a: 2\n", { expectedHash: null })).toThrow(ContentConflictError);
  });
});

describe("readCurrentHash", () => {
  it("returns null for a file that doesn't exist yet", () => {
    const root = temporaryRoot();
    expect(readCurrentHash(path.join(root, "missing.yaml"))).toBeNull();
  });

  it("matches hashContent for the same bytes", () => {
    const root = temporaryRoot();
    const target = path.join(root, "schedule.yaml");
    writeFileAtomically(target, "milestones: []\n");
    expect(readCurrentHash(target)).toBe(hashContent("milestones: []\n"));
  });
});

describe("backup: false", () => {
  it("keeps derived bookkeeping from accumulating copies in a shared folder", () => {
    /*
     * An analysis snapshot and a folder seen-index carry a timestamp, so they differ on
     * every run by definition. With backups on, pressing Analyze repeatedly left a growing
     * .mi-backups pile in the firm's Dropbox folder -- observed on the real 1000 W Example
     * record before this option existed.
     */
    const root = temporaryRoot();
    const target = path.join(root, "analysis.json");
    for (let run = 0; run < 4; run += 1) {
      const result = writeFileAtomically(target, `{"ranAt":${run}}\n`, { backup: false });
      expect(result.backupPath).toBeNull();
    }
    expect(fs.existsSync(path.join(root, ".mi-backups"))).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe('{"ranAt":3}\n');
  });

  it("still backs up by default, so authored content keeps its recovery copy", () => {
    const root = temporaryRoot();
    const target = path.join(root, "notes.md");
    writeFileAtomically(target, "first\n");
    const second = writeFileAtomically(target, "second\n");
    expect(second.backupPath).not.toBeNull();
    expect(fs.readFileSync(second.backupPath as string, "utf8")).toBe("first\n");
  });
});
