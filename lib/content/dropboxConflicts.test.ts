import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isConflictedCopyName, scanForConflicts } from "./dropboxConflicts";

describe("isConflictedCopyName", () => {
  it("recognizes Dropbox's conflicted-copy and case-conflict suffixes", () => {
    expect(isConflictedCopyName("schedule (Partner's conflicted copy 2026-07-26).yaml")).toBe(true);
    expect(isConflictedCopyName("file (case-conflict 2013-05-09).ext")).toBe(true);
    expect(isConflictedCopyName("notes (Alex's conflicted copy).md")).toBe(true);
  });

  it("does not false-positive on ordinary filenames", () => {
    expect(isConflictedCopyName("schedule.yaml")).toBe(false);
    expect(isConflictedCopyName("acme (updated).yaml")).toBe(false);
    expect(isConflictedCopyName("conflicted-copy-notes.md")).toBe(false);
    expect(isConflictedCopyName("meeting (1).md")).toBe(false);
  });
});

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-conflict-scan-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("scanForConflicts", () => {
  it("finds conflicted-copy files nested in subdirectories", () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, "schedule"), { recursive: true });
    fs.writeFileSync(path.join(root, "schedule", "schedule.yaml"), "milestones: []\n", "utf8");
    fs.writeFileSync(
      path.join(root, "schedule", "schedule (Partner's conflicted copy 2026-07-26).yaml"),
      "milestones: []\n",
      "utf8",
    );

    const results = scanForConflicts(root);
    expect(results).toEqual([
      expect.objectContaining({
        name: "schedule (Partner's conflicted copy 2026-07-26).yaml",
        likelyOriginalName: "schedule.yaml",
      }),
    ]);
  });

  it("ignores .mi-backups and dotfiles", () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, ".mi-backups"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".mi-backups", "schedule (conflicted copy).yaml"),
      "milestones: []\n",
      "utf8",
    );
    expect(scanForConflicts(root)).toEqual([]);
  });

  it("returns an empty array for a directory that doesn't exist", () => {
    expect(scanForConflicts(path.join(os.tmpdir(), "mi-does-not-exist-xyz"))).toEqual([]);
  });
});
