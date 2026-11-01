import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeDropboxRelativePath,
  normalizeDropboxSelection,
} from "./dropboxPaths";

describe("Dropbox project folder containment", () => {
  const root = path.resolve("C:/Dropbox/STUDIO");

  it("persists a normalized relative path", () => {
    expect(normalizeDropboxSelection(root, path.join(root, "Projects", "Demo")))
      .toBe("Projects/Demo");
    expect(normalizeDropboxRelativePath(root, "Projects\\Demo"))
      .toBe("Projects/Demo");
  });

  it("rejects the root, absolute paths, and traversal", () => {
    expect(() => normalizeDropboxSelection(root, root)).toThrow(/inside DROPBOX_ROOT/);
    expect(() => normalizeDropboxRelativePath(root, "../outside")).toThrow(/inside DROPBOX_ROOT/);
    expect(() => normalizeDropboxRelativePath(root, path.resolve("C:/outside"))).toThrow(/relative/);
  });
});
