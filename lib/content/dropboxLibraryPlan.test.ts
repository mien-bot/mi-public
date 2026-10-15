import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyDropboxLibraryPlan,
  previewDropboxLibraryPlan,
  RECOMMENDED_LIBRARY_FOLDERS,
} from "./dropboxLibraryPlan";

describe("Dropbox firm-library folder plan", () => {
  let root: string;
  let dropboxRoot: string;
  let parent: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-dropbox-plan-"));
    dropboxRoot = path.join(root, "Dropbox");
    parent = path.join(dropboxRoot, "Shared", "Firm-Library");
    fs.mkdirSync(parent, { recursive: true });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("previews the exact neutral proposal without creating anything", () => {
    fs.mkdirSync(path.join(parent, "99_Archive"));
    const preview = previewDropboxLibraryPlan(
      dropboxRoot,
      "Shared/Firm-Library",
      [...RECOMMENDED_LIBRARY_FOLDERS],
    );
    expect(preview.folders.map((item) => item.folder)).toEqual([...RECOMMENDED_LIBRARY_FOLDERS]);
    expect(preview.folders.find((item) => item.folder === "99_Archive")?.status).toBe("exists");
    expect(preview.folders.find((item) => item.folder === "01_Marketing")?.status).toBe("create");
    expect(fs.existsSync(path.join(parent, "01_Marketing"))).toBe(false);
  });

  it("requires separate confirmation and returns a result for every folder", () => {
    const folders = ["01_Marketing", "01_Marketing/Brand", "99_Archive"];
    expect(() => applyDropboxLibraryPlan(
      dropboxRoot,
      "Shared/Firm-Library",
      folders,
      false,
    )).toThrow(/confirmation/);
    const applied = applyDropboxLibraryPlan(
      dropboxRoot,
      "Shared/Firm-Library",
      folders,
      true,
    );
    expect(applied.results).toHaveLength(3);
    expect(applied.results.every((item) => item.status === "created")).toBe(true);
    expect(fs.statSync(path.join(parent, "01_Marketing", "Brand")).isDirectory()).toBe(true);
  });

  it("reports file conflicts and rejects absolute paths and traversal", () => {
    fs.writeFileSync(path.join(parent, "01_Marketing"), "fixture");
    const preview = previewDropboxLibraryPlan(
      dropboxRoot,
      "Shared/Firm-Library",
      ["01_Marketing"],
    );
    expect(preview.canApply).toBe(false);
    expect(preview.folders[0]?.status).toBe("conflict");
    expect(() => previewDropboxLibraryPlan(dropboxRoot, "../outside", ["Folder"])).toThrow();
    expect(() => previewDropboxLibraryPlan(dropboxRoot, "Shared/Firm-Library", ["C:\\outside"]))
      .toThrow(/relative/);
  });

  it("rejects a symlink or junction escape", () => {
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(parent, "linked"), process.platform === "win32" ? "junction" : "dir");
    expect(() => previewDropboxLibraryPlan(
      dropboxRoot,
      "Shared/Firm-Library",
      ["linked/escape"],
    )).toThrow(/symbolic link/);
  });
});
