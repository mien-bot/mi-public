import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";
import { ContentConflictError, readCurrentHash } from "./atomicContentWrite";
import { writeYamlAtomically } from "./leadLibraryAtomicWrite";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-lead-library-atomic-write-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("writeYamlAtomically", () => {
  it("creates a new file with no expectedHash given", () => {
    const root = temporaryRoot();
    const target = path.join(root, "lead.yaml");
    writeYamlAtomically(target, { name: "Acme" });
    expect(loadYaml(fs.readFileSync(target, "utf8"))).toEqual({ name: "Acme" });
  });

  it("refuses to write when expectedHash no longer matches the current file", () => {
    const root = temporaryRoot();
    const target = path.join(root, "lead.yaml");
    writeYamlAtomically(target, { name: "Acme", status: "new" });
    const staleHash = readCurrentHash(target);
    // Someone else's write lands in between the stale read and this write.
    writeYamlAtomically(target, { name: "Acme", status: "qualified" });

    expect(() => writeYamlAtomically(target, { name: "Acme", status: "won" }, { expectedHash: staleHash }))
      .toThrow(ContentConflictError);
    expect(loadYaml(fs.readFileSync(target, "utf8"))).toEqual({ name: "Acme", status: "qualified" });
  });

  it("writes successfully when expectedHash matches the current file", () => {
    const root = temporaryRoot();
    const target = path.join(root, "lead.yaml");
    writeYamlAtomically(target, { name: "Acme", status: "new" });
    const currentHash = readCurrentHash(target);
    writeYamlAtomically(target, { name: "Acme", status: "qualified" }, { expectedHash: currentHash });
    expect(loadYaml(fs.readFileSync(target, "utf8"))).toEqual({ name: "Acme", status: "qualified" });
  });

  it("treats expectedHash: null as \"must not already exist\"", () => {
    const root = temporaryRoot();
    const target = path.join(root, "engagement.yaml");
    writeYamlAtomically(target, { name: "First" }, { expectedHash: null });
    expect(() => writeYamlAtomically(target, { name: "Second" }, { expectedHash: null }))
      .toThrow(ContentConflictError);
  });
});
