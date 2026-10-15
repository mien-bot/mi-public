import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { resolveRuntimeDataRoot } = require("./runtimeDataRoot");
const { ensureLeadHarness } = require("./leadHarness");
const { resolveLeadTerminalWorkspace } = require("./leadRuntime");
const { ensurePermitQaqcHarness } = require("./permitQaqcHarness");
const { resolvePermitQaqcTerminalWorkspace } = require("./permitQaqcRuntime");
const { resolveInstalledProjectWorkspace } = require("./projectRuntime");

/**
 * Everyone at the firm syncs the same Dropbox contents, but each person's local Dropbox folder
 * has its own name and location -- one partner's root is `E:\Dropbox\STUDIO`, another's is
 * `D:\Dropbox (Personal)\EXAMPLE STUDIO`. Only that absolute root is per-machine; every stored
 * path is relative to it. These build two roots whose names share nothing and whose contents
 * are identical, then assert every workspace resolver lands on the same folder relative to
 * whichever root it was given.
 */

const roots: string[] = [];

const LEAD_DROPBOX_PATH = "1.01 LEADS/26_0726_Alpha Ave";
// Written with backslashes exactly as the Permit QAQC form stores it on Windows. A resolver
// that splits on "/" alone would silently treat this as one long folder name.
const ENGAGEMENT_DROPBOX_PATH = "1.00 PROJECTS\\PERMIT QAQC\\03_Beta Ave, Example City_SampleConsultant\\Received\\26_0726";
const PROJECT_DROPBOX_PATH = "1.00 PROJECTS/06_Gamma";

function machine(dropboxFolderName: string) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mi-second-computer-"));
  roots.push(base);
  const dropboxRoot = path.join(base, dropboxFolderName);
  const localDataRoot = path.join(base, "local-app-data");
  const shared = path.join(dropboxRoot, "7.00 Mi Data");

  fs.mkdirSync(path.join(shared, "leads", "alpha"), { recursive: true });
  fs.mkdirSync(path.join(shared, "permit-qaqc", "beta"), { recursive: true });
  fs.mkdirSync(localDataRoot, { recursive: true });
  fs.writeFileSync(
    path.join(shared, "leads", "alpha", "lead.yaml"),
    `name: Alpha Lead\nstatus: qualified\ndropbox_path: ${JSON.stringify(LEAD_DROPBOX_PATH)}\n`,
  );
  fs.writeFileSync(
    path.join(shared, "permit-qaqc", "beta", "qaqc.yaml"),
    [
      "name: Beta Ave",
      "submitting_firm: SampleConsultant",
      "status: resubmitted",
      "engagement_number: '03'",
      `dropbox_path: ${JSON.stringify(ENGAGEMENT_DROPBOX_PATH)}`,
      "rounds: []",
    ].join("\n"),
  );

  // The synced Dropbox contents themselves, identical on every machine.
  fs.mkdirSync(path.join(dropboxRoot, ...LEAD_DROPBOX_PATH.split("/")), { recursive: true });
  fs.mkdirSync(path.join(dropboxRoot, ...ENGAGEMENT_DROPBOX_PATH.split("\\")), { recursive: true });
  const projectWorkspace = path.join(dropboxRoot, ...PROJECT_DROPBOX_PATH.split("/"), "Mi");
  fs.mkdirSync(projectWorkspace, { recursive: true });
  fs.writeFileSync(path.join(projectWorkspace, "AGENTS.md"), "generated\n", "utf8");
  fs.writeFileSync(path.join(projectWorkspace, "CLAUDE.md"), "generated\n", "utf8");

  const settings = {
    dropboxRoot,
    dropboxFirmDataPath: "7.00 Mi Data",
    dropboxFirmDataMigrated: true,
    sharedDataRootEnabled: true,
  };
  const runtimeDataRoot = resolveRuntimeDataRoot({
    packaged: true,
    developmentRoot: base,
    localDataRoot,
    dropboxRoot,
    sharedRelativePath: settings.dropboxFirmDataPath,
    sharedDataRootEnabled: settings.sharedDataRootEnabled,
  });
  return { dropboxRoot, runtimeDataRoot, settings };
}

/** What the resolver found, expressed the only way that is comparable across machines. */
function underRoot(dropboxRoot: string, resolved: string): string {
  return path.relative(dropboxRoot, resolved).split(path.sep).join("/");
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("a second computer with its own Dropbox folder name", () => {
  const LEAD_TEMPLATE = path.join(process.cwd(), "installer", "agent-harness", "lead-common-rules.md");
  const ENGAGEMENT_TEMPLATE = path.join(process.cwd(), "installer", "agent-harness", "permit-qaqc-common-rules.md");
  const machines = () => [machine("STUDIO"), machine("EXAMPLE STUDIO (Personal)")];

  it("reads the firm's shared Mi data through each machine's own absolute root", () => {
    for (const { dropboxRoot, runtimeDataRoot } of machines()) {
      expect(underRoot(dropboxRoot, runtimeDataRoot)).toBe("7.00 Mi Data");
      expect(fs.existsSync(path.join(runtimeDataRoot, "leads", "alpha", "lead.yaml"))).toBe(true);
    }
  });

  it("opens the same lead workspace on both machines", () => {
    for (const { dropboxRoot, runtimeDataRoot, settings } of machines()) {
      ensureLeadHarness({ runtimeDataRoot, settings, slug: "alpha", templatePath: LEAD_TEMPLATE });
      const workspace = resolveLeadTerminalWorkspace({ runtimeDataRoot, settings, slug: "alpha" });
      expect(underRoot(dropboxRoot, workspace)).toBe(`${LEAD_DROPBOX_PATH}/Mi`);
    }
  });

  it("opens the same Permit QAQC workspace on both machines, including a backslash-written path", () => {
    for (const { dropboxRoot, runtimeDataRoot, settings } of machines()) {
      ensurePermitQaqcHarness({ runtimeDataRoot, settings, slug: "beta", templatePath: ENGAGEMENT_TEMPLATE });
      const workspace = resolvePermitQaqcTerminalWorkspace({ runtimeDataRoot, settings, slug: "beta" });
      expect(underRoot(dropboxRoot, workspace)).toBe(
        `${ENGAGEMENT_DROPBOX_PATH.split("\\").join("/")}/Mi`,
      );
    }
  });

  it("opens the same project workspace on both machines", () => {
    for (const { dropboxRoot, settings } of machines()) {
      const workspace = resolveInstalledProjectWorkspace({
        dropboxRoot: settings.dropboxRoot,
        dropboxPath: PROJECT_DROPBOX_PATH,
      });
      expect(underRoot(dropboxRoot, workspace)).toBe(`${PROJECT_DROPBOX_PATH}/Mi`);
    }
  });

  it("never stores the machine it was generated on into the shared workspace", () => {
    const [first] = machines();
    ensureLeadHarness({
      runtimeDataRoot: first.runtimeDataRoot,
      settings: first.settings,
      slug: "alpha",
      templatePath: LEAD_TEMPLATE,
    });
    const harnessRoot = path.join(first.dropboxRoot, ...LEAD_DROPBOX_PATH.split("/"), "Mi");
    for (const file of ["LEAD_CONTEXT.md", "manifest.json"]) {
      const content = fs.readFileSync(path.join(harnessRoot, file), "utf8");
      expect(content).not.toContain(first.dropboxRoot);
      expect(content).toContain(LEAD_DROPBOX_PATH);
    }
  });
});
