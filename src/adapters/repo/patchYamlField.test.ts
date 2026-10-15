import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentConflictError, hashContent } from "@/lib/content/atomicContentWrite";
import { patchScalarField, patchScalarFields } from "./patchYamlField";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(content = "name: Demo\nstatus: not-started\n"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-yaml-patch-"));
  roots.push(root);
  const filePath = path.join(root, "project.yaml");
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe("patchScalarFields", () => {
  it("updates multiple scalars atomically and preserves surrounding text", () => {
    const filePath = fixture("# keep this\nname: Demo\nstatus: not-started\n");
    patchScalarFields(filePath, { status: "in-progress", client: '"Studio"' });
    expect(fs.readFileSync(filePath, "utf8")).toBe(
      '# keep this\nname: Demo\nstatus: in-progress\nclient: "Studio"\n',
    );
  });

  it("refuses a stale expected hash", () => {
    const filePath = fixture();
    const staleHash = hashContent(fs.readFileSync(filePath));
    fs.appendFileSync(filePath, "client: changed elsewhere\n");
    expect(() => patchScalarFields(filePath, { status: "complete" }, staleHash))
      .toThrow(ContentConflictError);
  });

  it("keeps the single-field compatibility wrapper", () => {
    const filePath = fixture();
    patchScalarField(filePath, "status", "complete");
    expect(fs.readFileSync(filePath, "utf8")).toContain("status: complete");
  });
});
