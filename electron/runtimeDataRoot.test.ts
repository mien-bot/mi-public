import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { resolveRuntimeDataRoot } = require("./runtimeDataRoot");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-runtime-data-"));
  roots.push(root);
  const localDataRoot = path.join(root, "Profile", "data");
  const dropboxRoot = path.join(root, "Dropbox", "STUDIO");
  const sharedRoot = path.join(dropboxRoot, "7.00 Mi Data");
  fs.mkdirSync(localDataRoot, { recursive: true });
  fs.mkdirSync(sharedRoot, { recursive: true });
  return { root, localDataRoot, dropboxRoot, sharedRoot };
}

describe("installed runtime data root", () => {
  it("keeps development and unconfirmed installed data local", () => {
    const { root, localDataRoot, dropboxRoot } = fixture();
    expect(resolveRuntimeDataRoot({
      packaged: false,
      developmentRoot: root,
      localDataRoot,
      dropboxRoot,
      sharedRelativePath: "7.00 Mi Data",
      sharedDataRootEnabled: true,
    })).toBe(path.resolve(root));
    expect(resolveRuntimeDataRoot({
      packaged: true,
      developmentRoot: root,
      localDataRoot,
      dropboxRoot,
      sharedRelativePath: "7.00 Mi Data",
      sharedDataRootEnabled: false,
    })).toBe(path.resolve(localDataRoot));
  });

  it("uses the exact confirmed shared folder when explicitly enabled", () => {
    const { root, localDataRoot, dropboxRoot, sharedRoot } = fixture();
    expect(resolveRuntimeDataRoot({
      packaged: true,
      developmentRoot: root,
      localDataRoot,
      dropboxRoot,
      sharedRelativePath: "7.00 Mi Data",
      sharedDataRootEnabled: true,
    })).toBe(path.resolve(sharedRoot));
  });

  it("fails closed for missing or escaping shared paths", () => {
    const { root, localDataRoot, dropboxRoot } = fixture();
    const options = {
      packaged: true,
      developmentRoot: root,
      localDataRoot,
      dropboxRoot,
      sharedDataRootEnabled: true,
    };
    expect(() => resolveRuntimeDataRoot({
      ...options,
      sharedRelativePath: "../outside",
    })).toThrow(/inside the configured Dropbox root/);
    expect(() => resolveRuntimeDataRoot({
      ...options,
      sharedRelativePath: "missing",
    })).toThrow(/unavailable/);
  });
});
