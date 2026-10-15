import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const { resolveInstalledProjectWorkspace } = require("./projectRuntime");

describe("installed project launch containment", () => {
  it("uses the project Mi folder and rejects traversal", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-runtime-"));
    try {
      const workspace = path.join(root, "1.00 PROJECTS", "Demo", "Mi");
      fs.mkdirSync(workspace, { recursive: true });
      fs.writeFileSync(path.join(workspace, "AGENTS.md"), "rules");
      fs.writeFileSync(path.join(workspace, "CLAUDE.md"), "rules");
      expect(resolveInstalledProjectWorkspace({
        dropboxRoot: root,
        dropboxPath: "1.00 PROJECTS/Demo",
      })).toBe(fs.realpathSync(workspace));
      expect(() => resolveInstalledProjectWorkspace({
        dropboxRoot: root,
        dropboxPath: "../outside",
      })).toThrow(/escapes/);
      expect(() => resolveInstalledProjectWorkspace({
        dropboxRoot: root,
        dropboxPath: "",
      })).toThrow(/Confirm this project's Dropbox folder/);
      fs.mkdirSync(path.join(root, "1.00 PROJECTS", "No Harness"));
      expect(() => resolveInstalledProjectWorkspace({
        dropboxRoot: root,
        dropboxPath: "1.00 PROJECTS/No Harness",
      })).toThrow(/Repair\/Refresh Agent Workspace/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a Mi junction that resolves outside the confirmed project folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-runtime-junction-"));
    try {
      const projectRoot = path.join(root, "1.00 PROJECTS", "Demo");
      const outside = path.join(root, "outside");
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "AGENTS.md"), "rules");
      fs.writeFileSync(path.join(outside, "CLAUDE.md"), "rules");
      fs.symlinkSync(outside, path.join(projectRoot, "Mi"), "junction");

      expect(() => resolveInstalledProjectWorkspace({
        dropboxRoot: root,
        dropboxPath: "1.00 PROJECTS/Demo",
      })).toThrow(/workspace escapes/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
