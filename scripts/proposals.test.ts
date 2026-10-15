import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseProposalSubmitArgs, readProposalSourceFile } from "./proposals";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("mi proposals submit", () => {
  it("requires a project and exactly one JSON file", () => {
    expect(parseProposalSubmitArgs(["submit", "--project", "studio-marketing", "draft.json"]))
      .toEqual({ help: false, project: "studio-marketing", filePath: "draft.json" });
    expect(() => parseProposalSubmitArgs(["submit", "draft.json"])).toThrow(/--project/);
    expect(() => parseProposalSubmitArgs(["submit", "--project", "bad slug", "draft.json"]))
      .toThrow(/valid --project/);
  });

  it("reads a relative exact-byte JSON file from the caller workspace", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-proposals-cli-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "draft.json"), '\uFEFF{"version":1,"proposals":[]}\n', "utf8");
    expect(readProposalSourceFile("draft.json", root)).toBe('{"version":1,"proposals":[]}\n');
    fs.writeFileSync(path.join(root, "draft.txt"), "{}", "utf8");
    expect(() => readProposalSourceFile("draft.txt", root)).toThrow(/\.json/);
  });
});
