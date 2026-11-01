import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveReviewFolder } from "./reviewFolderTarget";

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
