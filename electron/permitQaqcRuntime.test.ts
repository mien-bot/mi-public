import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const {
  permitQaqcSlugFromCwd,
  resolvePermitQaqcHarnessRoot,
  resolvePermitQaqcTerminalWorkspace,
} = require("./permitQaqcRuntime");

const roots: string[] = [];

function fixture(dropboxPath: string | null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-permit-qaqc-terminal-"));
  roots.push(root);
  const runtimeDataRoot = path.join(root, "runtime");
  const dropboxRoot = path.join(root, "dropbox");
  const engagementDirectory = path.join(runtimeDataRoot, "permit-qaqc", "alpha");
  fs.mkdirSync(engagementDirectory, { recursive: true });
  fs.mkdirSync(dropboxRoot, { recursive: true });
  fs.writeFileSync(
    path.join(engagementDirectory, "qaqc.yaml"),
    `name: Alpha\nsubmitting_firm: SampleConsultant\ndropbox_path: ${dropboxPath === null ? "null" : JSON.stringify(dropboxPath)}\n`,
  );
  return {
    runtimeDataRoot,
    dropboxRoot,
    engagementDirectory,
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

describe("permit-qaqc terminal runtime", () => {
  it("recognizes only an exact permit-qaqc workspace token", () => {
    expect(permitQaqcSlugFromCwd("permit-qaqc/alpha")).toBe("alpha");
    expect(permitQaqcSlugFromCwd("permit-qaqc\\alpha")).toBe("alpha");
    expect(permitQaqcSlugFromCwd("permit-qaqc/alpha/files")).toBeNull();
    expect(permitQaqcSlugFromCwd("permit-qaqc/../outside")).toBeNull();
  });

  it("resolves the harness root under the structured engagement directory when no Dropbox folder is linked", () => {
    const item = fixture(null);
    const { workspaceRoot, harnessRoot, dropboxPath } = resolvePermitQaqcHarnessRoot({ ...item, slug: "alpha" });
    expect(workspaceRoot).toBe(fs.realpathSync(item.engagementDirectory));
    expect(harnessRoot).toBe(path.join(fs.realpathSync(item.engagementDirectory), "Mi"));
    expect(dropboxPath).toBeNull();
  });

  it("resolves the harness root under the exact confirmed Dropbox folder when it is linked", () => {
    const item = fixture("PERMIT QAQC/03_Alpha");
    const dropboxEngagement = path.join(item.dropboxRoot, "PERMIT QAQC", "03_Alpha");
    fs.mkdirSync(dropboxEngagement, { recursive: true });
    const { workspaceRoot, harnessRoot } = resolvePermitQaqcHarnessRoot({ ...item, slug: "alpha" });
    expect(workspaceRoot).toBe(fs.realpathSync(dropboxEngagement));
    expect(harnessRoot).toBe(path.join(fs.realpathSync(dropboxEngagement), "Mi"));
  });

  it("refuses to launch a terminal until the agent workspace has been generated", () => {
    const item = fixture(null);
    expect(() => resolvePermitQaqcTerminalWorkspace({ ...item, slug: "alpha" })).toThrow(/Repair\/Refresh/i);
  });

  it("starts inside the generated Mi/ folder under the structured engagement directory once repaired", () => {
    const item = fixture(null);
    writeHarnessStub(path.join(item.engagementDirectory, "Mi"));
    expect(resolvePermitQaqcTerminalWorkspace({ ...item, slug: "alpha" })).toBe(
      fs.realpathSync(path.join(item.engagementDirectory, "Mi")),
    );
  });

  it("starts inside the generated Mi/ folder under the confirmed Dropbox folder once repaired", () => {
    const item = fixture("PERMIT QAQC/03_Alpha");
    const dropboxEngagement = path.join(item.dropboxRoot, "PERMIT QAQC", "03_Alpha");
    fs.mkdirSync(dropboxEngagement, { recursive: true });
    writeHarnessStub(path.join(dropboxEngagement, "Mi"));
    expect(resolvePermitQaqcTerminalWorkspace({ ...item, slug: "alpha" })).toBe(
      fs.realpathSync(path.join(dropboxEngagement, "Mi")),
    );
  });

  it("rejects traversal and unreachable confirmed folders instead of falling back", () => {
    const traversal = fixture("../outside");
    expect(() => resolvePermitQaqcHarnessRoot({ ...traversal, slug: "alpha" })).toThrow(/unsafe segment/i);
    const missing = fixture("PERMIT QAQC/Missing");
    expect(() => resolvePermitQaqcHarnessRoot({ ...missing, slug: "alpha" })).toThrow(/not reachable/i);
  });
});
