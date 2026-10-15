import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const {
  leadSlugFromCwd,
  resolveLeadHarnessRoot,
  resolveLeadTerminalWorkspace,
  resolveLeadWorkspaceRoot,
} = require("./leadRuntime");

const roots: string[] = [];

function fixture(dropboxPath: string | null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-lead-terminal-"));
  roots.push(root);
  const runtimeDataRoot = path.join(root, "runtime");
  const dropboxRoot = path.join(root, "dropbox");
  const leadDirectory = path.join(runtimeDataRoot, "leads", "alpha");
  fs.mkdirSync(leadDirectory, { recursive: true });
  fs.mkdirSync(dropboxRoot, { recursive: true });
  fs.writeFileSync(
    path.join(leadDirectory, "lead.yaml"),
    `name: Alpha\ndropbox_path: ${dropboxPath === null ? "null" : JSON.stringify(dropboxPath)}\n`,
  );
  return {
    runtimeDataRoot,
    dropboxRoot,
    leadDirectory,
    settings: {
      dropboxRoot,
      dropboxFirmDataPath: null,
      dropboxFirmDataMigrated: false,
    },
  };
}

function writeHarnessStub(harnessRoot: string) {
  fs.mkdirSync(harnessRoot, { recursive: true });
  fs.writeFileSync(path.join(harnessRoot, "AGENTS.md"), "stub\n", "utf8");
  fs.writeFileSync(path.join(harnessRoot, "CLAUDE.md"), "stub\n", "utf8");
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("lead terminal runtime", () => {
  it("recognizes only an exact lead workspace token", () => {
    expect(leadSlugFromCwd("leads/alpha")).toBe("alpha");
    expect(leadSlugFromCwd("leads\\alpha")).toBe("alpha");
    expect(leadSlugFromCwd("leads/alpha/files")).toBeNull();
    expect(leadSlugFromCwd("leads/../outside")).toBeNull();
  });

  it("resolves the harness root under the structured lead directory when no Dropbox folder is linked", () => {
    const item = fixture(null);
    const { workspaceRoot, harnessRoot, dropboxPath } = resolveLeadHarnessRoot({ ...item, slug: "alpha" });
    expect(workspaceRoot).toBe(fs.realpathSync(item.leadDirectory));
    expect(harnessRoot).toBe(path.join(fs.realpathSync(item.leadDirectory), "Mi"));
    expect(dropboxPath).toBeNull();
  });

  it("resolves the harness root under the exact confirmed Dropbox folder when it is linked", () => {
    const item = fixture("1.01 LEADS/Alpha");
    const dropboxLead = path.join(item.dropboxRoot, "1.01 LEADS", "Alpha");
    fs.mkdirSync(dropboxLead, { recursive: true });
    const { workspaceRoot, harnessRoot } = resolveLeadHarnessRoot({ ...item, slug: "alpha" });
    expect(workspaceRoot).toBe(fs.realpathSync(dropboxLead));
    expect(harnessRoot).toBe(path.join(fs.realpathSync(dropboxLead), "Mi"));
  });

  it("refuses to launch a terminal until the agent workspace has been generated", () => {
    const item = fixture(null);
    expect(() => resolveLeadTerminalWorkspace({ ...item, slug: "alpha" })).toThrow(/Repair\/Refresh/i);
  });

  it("starts inside the generated Mi/ folder under the structured lead directory once repaired", () => {
    const item = fixture(null);
    writeHarnessStub(path.join(item.leadDirectory, "Mi"));
    expect(resolveLeadTerminalWorkspace({ ...item, slug: "alpha" })).toBe(
      fs.realpathSync(path.join(item.leadDirectory, "Mi")),
    );
  });

  it("starts inside the generated Mi/ folder under the confirmed Dropbox folder once repaired", () => {
    const item = fixture("1.01 LEADS/Alpha");
    const dropboxLead = path.join(item.dropboxRoot, "1.01 LEADS", "Alpha");
    fs.mkdirSync(dropboxLead, { recursive: true });
    writeHarnessStub(path.join(dropboxLead, "Mi"));
    expect(resolveLeadTerminalWorkspace({ ...item, slug: "alpha" })).toBe(
      fs.realpathSync(path.join(dropboxLead, "Mi")),
    );
  });

  it("rejects traversal and unreachable confirmed folders instead of falling back", () => {
    const traversal = fixture("../outside");
    expect(() => resolveLeadWorkspaceRoot({ ...traversal, slug: "alpha" })).toThrow(/unsafe segment/i);
    const missing = fixture("1.01 LEADS/Missing");
    expect(() => resolveLeadWorkspaceRoot({ ...missing, slug: "alpha" })).toThrow(/not reachable/i);
  });
});
