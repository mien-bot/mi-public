import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createAllProjectHarnessManager } = require("./allProjectHarness");

const roots: string[] = [];

function writeProject(dataRoot: string, slug: string, name: string, dropboxPath?: string) {
  const projectDir = path.join(dataRoot, "projects", slug);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "project.yaml"),
    `name: ${name}\n${dropboxPath === undefined ? "" : `dropbox_path: ${dropboxPath}\n`}`,
    "utf8",
  );
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-all-harness-"));
  roots.push(root);
  const dataRoot = path.join(root, "local");
  const dropboxRoot = path.join(root, "STUDIO Dropbox");
  const templatePath = path.join(root, "common-rules.md");
  fs.mkdirSync(path.join(dropboxRoot, "Projects", "Linked"), { recursive: true });
  fs.writeFileSync(templatePath, "Synthetic canonical rule.\n", "utf8");
  writeProject(dataRoot, "linked", "Linked", "Projects/Linked");
  writeProject(dataRoot, "missing", "Missing", "Projects/Missing");
  writeProject(dataRoot, "unlinked", "Unlinked");
  return { root, dataRoot, dropboxRoot, templatePath };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("all-project harness manager", () => {
  it("reports per-file conflicts as partial and rejects relinked folders after preview", () => {
    const item = fixture();
    const apply = vi.fn(() => [{ relativePath: "AGENTS.md", status: "conflict", error: "Changed" }]);
    const manager = createAllProjectHarnessManager({ applyHarnessPreviewImpl: apply });
    const args = { dataRoot: item.dataRoot, dropboxRoot: item.dropboxRoot, timezone: "America/Chicago", templatePath: item.templatePath };
    const first = manager.previewAll(args);
    expect(manager.applyAll({ previewId: first.previewId, confirmed: true }).projects[0].status).toBe("partial");
    const next = manager.previewAll(args);
    writeProject(item.dataRoot, "linked", "Linked", "Projects/Changed");
    const result = manager.applyAll({ previewId: next.previewId, confirmed: true });
    expect(result.projects[0]).toMatchObject({ status: "failed" });
    expect(result.projects[0].error).toMatch(/linked folder/);
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it("previews linked, unlinked, and missing-folder projects without writing", () => {
    const item = fixture();
    const manager = createAllProjectHarnessManager({
      idFactory: (() => {
        let id = 0;
        return () => `preview-${++id}`;
      })(),
    });

    const result = manager.previewAll({
      dataRoot: item.dataRoot,
      dropboxRoot: item.dropboxRoot,
      timezone: "America/Chicago",
      templatePath: item.templatePath,
    });

    expect(result.projects.find((project: { slug: string }) => project.slug === "linked")).toMatchObject({
      name: "Linked",
      slug: "linked",
      dropboxPath: "Projects/Linked",
      status: "ready",
    });
    expect(result.projects.find((project: { slug: string }) => project.slug === "missing")).toMatchObject({
      status: "error",
      dropboxPath: "Projects/Missing",
    });
    expect(result.skipped).toEqual([{
      name: "Unlinked",
      slug: "unlinked",
      reason: "No human-confirmed Dropbox folder is linked.",
    }]);
    expect(fs.existsSync(path.join(item.dropboxRoot, "Projects", "Linked", "Mi"))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(item.dropboxRoot);
  });

  it("requires confirmation, consumes an exact preview once, and never applies ineligible projects", () => {
    const item = fixture();
    const manager = createAllProjectHarnessManager();
    const preview = manager.previewAll({
      dataRoot: item.dataRoot,
      dropboxRoot: item.dropboxRoot,
      timezone: "America/Chicago",
      templatePath: item.templatePath,
    });

    expect(() => manager.applyAll({ previewId: preview.previewId, confirmed: false })).toThrow(/confirmation/);
    expect(fs.existsSync(path.join(item.dropboxRoot, "Projects", "Linked", "Mi"))).toBe(false);
    const result = manager.applyAll({ previewId: preview.previewId, confirmed: true });
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({ slug: "linked", status: "applied" });
    expect(fs.existsSync(path.join(item.dropboxRoot, "Projects", "Linked", "Mi", "AGENTS.md"))).toBe(true);
    expect(() => manager.applyAll({ previewId: preview.previewId, confirmed: true })).toThrow(/expired|already applied/);
  });

  it("isolates one project apply failure and returns the other file results", () => {
    const item = fixture();
    fs.mkdirSync(path.join(item.dropboxRoot, "Projects", "Second"), { recursive: true });
    writeProject(item.dataRoot, "second", "Second", "Projects/Second");
    const apply = vi.fn((preview: { harnessRoot: string }) => {
      if (preview.harnessRoot.includes("Linked")) throw new Error(`synthetic failure at ${item.dropboxRoot}`);
      return [{ relativePath: "AGENTS.md", status: "created" }];
    });
    const manager = createAllProjectHarnessManager({ applyHarnessPreviewImpl: apply });
    const preview = manager.previewAll({
      dataRoot: item.dataRoot,
      dropboxRoot: item.dropboxRoot,
      timezone: "America/Chicago",
      templatePath: item.templatePath,
    });

    const result = manager.applyAll({ previewId: preview.previewId, confirmed: true });
    expect(result.projects.find((project: { slug: string }) => project.slug === "linked")).toMatchObject({
      status: "failed",
      error: "synthetic failure at <DROPBOX_ROOT>",
    });
    expect(result.projects.find((project: { slug: string }) => project.slug === "second")).toMatchObject({
      status: "applied",
      results: [{ relativePath: "AGENTS.md", status: "created" }],
    });
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
