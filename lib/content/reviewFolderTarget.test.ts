import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReviewFolder, resolveReviewFolder, validateNewFolderName } from "./reviewFolderTarget";

describe("resolveReviewFolder", () => {
  let root: string;
  beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mi-review-folder-")));
    fs.mkdirSync(path.join(root, "project", "01_Admin"), { recursive: true });
    fs.mkdirSync(path.join(root, "other"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("accepts the workspace folder and its children", () => {
    expect(resolveReviewFolder("project", ".", root).relative).toBe(".");
    const target = resolveReviewFolder("project", "01_Admin", root);
    expect(target.relative).toBe("01_Admin");
    expect(target.file).toBe(path.join(root, "project", "01_Admin", "Mi Review Notes.md"));
  });

  it("refuses anything outside the workspace folder or missing", () => {
    expect(() => resolveReviewFolder("project", "../other", root)).toThrow("inside");
    expect(() => resolveReviewFolder("project", path.join(root, "other"), root)).toThrow("inside");
    expect(() => resolveReviewFolder("project", "missing", root)).toThrow("does not exist");
  });
});

describe("createReviewFolder", () => {
  let root: string;
  beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mi-review-new-folder-")));
    fs.mkdirSync(path.join(root, "project", "01_Admin"), { recursive: true });
    fs.writeFileSync(path.join(root, "project", "notes.txt"), "");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("creates a folder in the project's main folder or a chosen subfolder", () => {
    expect(createReviewFolder("project", ".", " Review Notes ", root)).toEqual({ relative: "Review Notes", created: true });
    expect(fs.statSync(path.join(root, "project", "Review Notes")).isDirectory()).toBe(true);
    expect(createReviewFolder("project", "01_Admin", "Reviews", root)).toEqual({ relative: "01_Admin/Reviews", created: true });
    expect(resolveReviewFolder("project", "01_Admin/Reviews", root).relative).toBe("01_Admin/Reviews");
  });

  it("reuses an existing folder and refuses a file of the same name", () => {
    expect(createReviewFolder("project", ".", "01_Admin", root)).toEqual({ relative: "01_Admin", created: false });
    expect(() => createReviewFolder("project", ".", "notes.txt", root)).toThrow("file with that name");
  });

  it("refuses paths, unsafe names, and parents outside the project", () => {
    for (const name of ["", "a/b", "a\\b", "..", "CON", "nul.txt", "trailing.", "what?"]) {
      expect(() => validateNewFolderName(name)).toThrow();
    }
    expect(() => createReviewFolder("project", "../", "x", root)).toThrow("inside");
    expect(() => createReviewFolder("project", "missing", "x", root)).toThrow("does not exist");
    expect(fs.existsSync(path.join(root, "x"))).toBe(false);
  });
});
