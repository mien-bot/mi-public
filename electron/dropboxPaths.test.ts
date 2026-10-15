import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { normalizeDropboxSelection } = require("./dropboxPaths.js") as { normalizeDropboxSelection(root: string, selected: string): string };

describe("Electron Dropbox picker containment", () => {
  const root = path.resolve("C:/Dropbox/STUDIO");
  it("returns only normalized relative paths inside DROPBOX_ROOT", () => {
    expect(normalizeDropboxSelection(root, path.join(root, "1.00 PROJECTS", "Demo"))).toBe("1.00 PROJECTS/Demo");
    expect(() => normalizeDropboxSelection(root, path.resolve(root, "..", "outside"))).toThrow(/inside DROPBOX_ROOT/);
  });
});
