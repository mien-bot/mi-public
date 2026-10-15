import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { resolveTerminalWorkspace } = require("./terminalWorkspace");
const { resolveInstalledProjectWorkspace } = require("./projectRuntime");
const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mi-terminal-links-")));
  roots.push(root);
  const runtimeDataRoot = path.join(root, "records");
  const dropboxRoot = path.join(root, "dropbox");
  fs.mkdirSync(dropboxRoot);
  function record(kind: string, slug: string, metadata: object) {
    const dir = path.join(runtimeDataRoot, kind, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, kind === "projects" ? "project.yaml" : "lead.yaml"), JSON.stringify(metadata));
  }
  function harness(relative: string) {
    const dir = path.join(dropboxRoot, relative, "Mi");
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ["AGENTS.md", "CLAUDE.md"]) fs.writeFileSync(path.join(dir, name), "fixture");
    return fs.realpathSync(dir);
  }
  const settings = { dropboxRoot };
  const resolve = (workspace: string) => resolveTerminalWorkspace({ workspace, runtimeDataRoot, settings });
  return { root, runtimeDataRoot, dropboxRoot, settings, record, resolve, harness };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("terminal workspace identity", () => {
  it("routes a converted lead and an explicitly linked older project to the same four-session identity", () => {
    const f = fixture();
    f.record("leads", "lead", { converted_project_slug: "current", dropbox_path: "missing-old-lead" });
    f.record("projects", "old", { terminal_project_slug: "current", dropbox_path: "missing-old-project" });
    f.record("projects", "current", { dropbox_path: "current-folder" });
    expect(f.resolve("leads/lead")).toBe("projects/current");
    expect(f.resolve("projects/old")).toBe("projects/current");
    expect(f.resolve("projects/current")).toBe("projects/current");
  });

  it("reads the current confirmed folder on each launch, even after a move", () => {
    const f = fixture();
    f.record("leads", "lead", { converted_project_slug: "current", dropbox_path: "missing" });
    const launch = () => {
      const workspace = f.resolve("leads/lead");
      const project = JSON.parse(fs.readFileSync(path.join(f.runtimeDataRoot, workspace, "project.yaml"), "utf8"));
      return resolveInstalledProjectWorkspace({ dropboxRoot: f.dropboxRoot, dropboxPath: project.dropbox_path });
    };
    const first = f.harness("first");
    f.record("projects", "current", { dropbox_path: "first" });
    expect(launch()).toBe(first);
    const second = f.harness("second");
    f.record("projects", "current", { dropbox_path: "second" });
    expect(launch()).toBe(second);
  });

  it("does not infer identity from a matching name or folder", () => {
    const f = fixture();
    f.record("leads", "lead", { name: "Same", dropbox_path: "missing" });
    f.record("projects", "old", { name: "Same", dropbox_path: "missing" });
    f.record("projects", "current", { name: "Same", dropbox_path: "new" });
    expect(f.resolve("leads/lead")).toBe("leads/lead");
    expect(f.resolve("projects/old")).toBe("projects/old");
  });

  it("uses the migrated shared lead records", () => {
    const f = fixture();
    f.record("leads", "lead", { converted_project_slug: null });
    f.record("projects", "current", {});
    const dir = path.join(f.dropboxRoot, "shared", "leads", "lead");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "lead.yaml"), JSON.stringify({ converted_project_slug: "current" }));
    expect(resolveTerminalWorkspace({ workspace: "leads/lead", runtimeDataRoot: f.runtimeDataRoot,
      settings: { ...f.settings, dropboxFirmDataMigrated: true, dropboxFirmDataPath: "shared" } })).toBe("projects/current");
  });

  it("rejects broken links, cycles, and traversal without falling back to stale folders", () => {
    const f = fixture();
    f.record("projects", "old", { terminal_project_slug: "missing" });
    expect(() => f.resolve("projects/old")).toThrow(/unavailable/);
    f.record("projects", "old", { terminal_project_slug: "old" });
    expect(() => f.resolve("projects/old")).toThrow(/cycle/);
    f.record("projects", "old", { terminal_project_slug: "../outside" });
    expect(() => f.resolve("projects/old")).toThrow(/Invalid/);
    f.record("leads", "lead", { converted_project_slug: "../outside" });
    expect(() => f.resolve("leads/lead")).toThrow(/Invalid/);
    f.record("projects", "old", { terminal_project_slug: false });
    expect(() => f.resolve("projects/old")).toThrow(/Invalid/);
  });

  it("rejects a linked project junction outside the records root", () => {
    const f = fixture();
    f.record("projects", "old", { terminal_project_slug: "escape" });
    const outside = path.join(f.root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "project.yaml"), "{}");
    fs.symlinkSync(outside, path.join(f.runtimeDataRoot, "projects", "escape"), "junction");
    expect(() => f.resolve("projects/old")).toThrow(/escapes/);
  });
});
