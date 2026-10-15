import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFiles } from "./fsUtils";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-fsutils-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("listFiles", () => {
  it("excludes a Dropbox conflicted-copy file even though it matches the extension filter", () => {
    const root = temporaryRoot();
    fs.writeFileSync(path.join(root, "acme.yaml"), "name: Acme\n", "utf8");
    fs.writeFileSync(path.join(root, "acme (Partner's conflicted copy 2026-07-26).yaml"), "name: Acme\n", "utf8");

    expect(listFiles(root, ".yaml")).toEqual(["acme.yaml"]);
  });

  it("still returns an empty array for a directory that doesn't exist", () => {
    expect(listFiles(path.join(os.tmpdir(), "mi-does-not-exist-xyz"))).toEqual([]);
  });
});
