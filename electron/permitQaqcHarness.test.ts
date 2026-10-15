import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const {
  applyPermitQaqcHarnessPreview,
  ensurePermitQaqcHarness,
  previewPermitQaqcHarness,
} = require("./permitQaqcHarness");

const roots: string[] = [];
const { SOURCE_RELATIVE_PATH, REFERENCE_PATH } = require("./permitQaqcGuidance");
const { hash } = require("./agentHarness");

function sharedGuidance(item: ReturnType<typeof fixture>, text: string) {
  const file = path.join(item.dropboxRoot, SOURCE_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function fixture(dropboxPath: string | null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-permit-qaqc-harness-"));
  roots.push(root);
  const runtimeDataRoot = path.join(root, "runtime");
  const dropboxRoot = path.join(root, "dropbox");
  const engagementDirectory = path.join(runtimeDataRoot, "permit-qaqc", "alpha");
  fs.mkdirSync(engagementDirectory, { recursive: true });
  fs.mkdirSync(dropboxRoot, { recursive: true });
  fs.writeFileSync(
    path.join(engagementDirectory, "qaqc.yaml"),
    [
      "name: Demo Engagement",
      "submitting_firm: SampleConsultant",
      "status: in-review",
      "engagement_number: '03'",
      `dropbox_path: ${dropboxPath === null ? "null" : JSON.stringify(dropboxPath)}`,
      "rounds:",
      "  - round_number: 1",
      "    received_date: 2026-06-18",
      "    response_sent_date: 2026-06-20",
      "    response_files: []",
      "    received_files: []",
    ].join("\n"),
  );
  const templatePath = path.join(root, "permit-qaqc-common-rules.md");
  fs.writeFileSync(templatePath, "Canonical shared rule.\nReview only, never a stamp.\n", "utf8");
  return {
    runtimeDataRoot,
    dropboxRoot,
    engagementDirectory,
    templatePath,
    slug: "alpha",
    synchronizedAt: "2026-07-30T12:00:00.000Z",
    settings: {
      dropboxRoot,
      dropboxFirmDataPath: null,
      dropboxFirmDataMigrated: false,
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("permit-qaqc agent harness", () => {
  it("performs no writes until explicitly confirmed", () => {
    const item = fixture(null);
    const preview = previewPermitQaqcHarness(item);
    expect(fs.existsSync(path.join(item.engagementDirectory, "Mi"))).toBe(false);
    expect(() => applyPermitQaqcHarnessPreview(preview, { confirmed: false })).toThrow(/confirmation/);
    expect(fs.existsSync(path.join(item.engagementDirectory, "Mi"))).toBe(false);
  });

  it("renders both agent files from one canonical source without secrets or absolute paths, for an engagement with no Dropbox link yet", () => {
    const item = fixture(null);
    const preview = previewPermitQaqcHarness(item);
    applyPermitQaqcHarnessPreview(preview, { confirmed: true });
    const agents = fs.readFileSync(path.join(item.engagementDirectory, "Mi", "AGENTS.md"), "utf8");
    const claude = fs.readFileSync(path.join(item.engagementDirectory, "Mi", "CLAUDE.md"), "utf8");
    expect(agents).toContain("Review only, never a stamp.");
    expect(claude).toContain("Review only, never a stamp.");
    expect(agents.match(/Canonical rules SHA-256: `([^`]+)`/)?.[1]).toBe(
      claude.match(/Canonical rules SHA-256: `([^`]+)`/)?.[1],
    );
    const engagementDoc = fs.readFileSync(path.join(item.engagementDirectory, "Mi", "ENGAGEMENT.md"), "utf8");
    expect(engagementDoc).toContain("Not linked");
    expect(engagementDoc).not.toContain(item.dropboxRoot);
    expect(engagementDoc).not.toContain("NOTION_API_KEY");
  });

  it("writes into the confirmed Dropbox engagement folder when one is linked", () => {
    const item = fixture("1.00 PROJECTS/PERMIT QAQC/03_Demo");
    const dropboxEngagement = path.join(item.dropboxRoot, "1.00 PROJECTS", "PERMIT QAQC", "03_Demo");
    fs.mkdirSync(dropboxEngagement, { recursive: true });
    const preview = previewPermitQaqcHarness(item);
    applyPermitQaqcHarnessPreview(preview, { confirmed: true });
    expect(fs.existsSync(path.join(item.engagementDirectory, "Mi"))).toBe(false);
    const engagementDoc = fs.readFileSync(path.join(dropboxEngagement, "Mi", "ENGAGEMENT.md"), "utf8");
    expect(engagementDoc).toContain("1.00 PROJECTS/PERMIT QAQC/03_Demo");
  });

  it("teaches the installed permit-qaqc rules template's real review-only invariant", () => {
    const item = fixture(null);
    item.templatePath = path.join(
      process.cwd(),
      "installer",
      "agent-harness",
      "permit-qaqc-common-rules.md",
    );
    const preview = previewPermitQaqcHarness(item);
    const instructions = [preview.desired.get("AGENTS.md"), preview.desired.get("CLAUDE.md")];
    for (const content of instructions) {
      expect(content).toContain("Review only, never a stamp");
      expect(content).toContain("formal submissions must be unbranded");
      expect(content).toContain("Verify every PDF in the actual application/upload folder");
      expect(content).not.toContain("Every PDF export must carry the Mi mark");
      expect(content).toContain("Folder taxonomy is **not** standardized");
      expect(content).toContain("What Mi is");
      expect(content).toContain("tools\\fetch-url.ps1");
      expect(content).toContain("references/chicago-permit-application-guidance.md");
      expect(content).toContain("current official instructions for the specific review program and portal");
      expect(content).toContain("Commercial\nConstruction");
      expect(content).toContain("Renovation of Structure");
      expect(content).toContain("SPR 2019 CBRC:");
      expect(content).toContain("new append-only inbox entries");
      expect(content).toContain("Never read, scan, or write anywhere outside this one confirmed engagement folder");
    }
    expect(preview.desired.get(path.join("tools", "fetch-url.ps1"))).toContain("/api/local-fetch");
  });

  it("creates a local complete shared reference with source, date and content version", () => {
    const item = fixture(null);
    const source = '# Shared guidance\nRecorded 2026-10-09.\nSource: https://www.chicago.gov/example\nRetrieved 2026-10-09T22:20:40.388Z\n\n## Correction history\nResidential selection corrected only for Hansen SPR.\n';
    sharedGuidance(item, source);
    const preview = previewPermitQaqcHarness(item);
    expect(preview.entries.find((entry: { relativePath: string }) => entry.relativePath === REFERENCE_PATH.replaceAll('\\','/'))?.action).toBe('create');
    applyPermitQaqcHarnessPreview(preview, {confirmed:true});
    const copy = fs.readFileSync(path.join(preview.harnessRoot, REFERENCE_PATH),'utf8');
    expect(copy).toContain(SOURCE_RELATIVE_PATH);
    expect(copy).toContain('Source recorded date: 2026-10-09');
    expect(copy).toContain(hash(source));
    expect(copy.endsWith(source)).toBe(true);
    expect(copy).not.toContain(item.dropboxRoot);
    for(const name of ['README.md','ENGAGEMENT.md']) {
      expect(fs.readFileSync(path.join(preview.harnessRoot,name),'utf8')).toContain('references/chicago-permit-application-guidance.md');
    }
    expect(ensurePermitQaqcHarness(item).results).toEqual([]);
  });

  it("refreshes existing workspaces while preserving evidence, user files and append-only inbox entries", () => {
    const item = fixture('1.00 PROJECTS/PERMIT QAQC/03_Demo');
    const engagement = path.join(item.dropboxRoot,'1.00 PROJECTS/PERMIT QAQC/03_Demo');
    fs.mkdirSync(engagement,{recursive:true});
    const { harnessRoot } = ensurePermitQaqcHarness(item);
    const oldCopy = fs.readFileSync(path.join(harnessRoot,REFERENCE_PATH),'utf8');
    const preserved = new Map([
      [path.join(engagement,'plans.pdf'),'Original project evidence'],
      [path.join(harnessRoot,'scratchpad','notes.md'),'Human notes'],
      [path.join(harnessRoot,'inbox','finding.json'),'Original append-only finding'],
      [path.join(harnessRoot,'inbox','correction.json'),'New correction; original retained'],
    ]);
    for(const [file,contents] of preserved) {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,contents);}
    const updated = '# Chicago guidance\nRecorded 2026-10-10.\nCorrection history retained.\n';
    sharedGuidance(item,updated);
    const preview = previewPermitQaqcHarness(item);
    applyPermitQaqcHarnessPreview(preview,{confirmed:true});
    expect(fs.readFileSync(path.join(harnessRoot,REFERENCE_PATH),'utf8').endsWith(updated)).toBe(true);
    for(const [file,contents] of preserved) expect(fs.readFileSync(file,'utf8')).toBe(contents);
    const backupDir = path.join(harnessRoot,'.mi-backups','references');
    expect(fs.readdirSync(backupDir).some(name=>fs.readFileSync(path.join(backupDir,name),'utf8')===oldCopy)).toBe(true);
    const source = path.join(item.dropboxRoot,SOURCE_RELATIVE_PATH);
    fs.unlinkSync(source);
    expect(ensurePermitQaqcHarness(item).results).toEqual([]);
    expect(fs.readFileSync(path.join(harnessRoot,REFERENCE_PATH),'utf8').endsWith(updated)).toBe(true);
  });

  it("uses the bundled authorized snapshot when creating offline and never overwrites a user reference", () => {
    const item = fixture(null);
    const { harnessRoot } = ensurePermitQaqcHarness(item);
    const target = path.join(harnessRoot,REFERENCE_PATH);
    const copy = fs.readFileSync(target,'utf8');
    const snapshot = fs.readFileSync(path.join(process.cwd(),'installer','agent-harness',REFERENCE_PATH),'utf8');
    expect(copy.endsWith(snapshot)).toBe(true);
    expect(copy).toContain('bundled authorized snapshot');
    fs.writeFileSync(target,'A human-owned reference.');
    sharedGuidance(item,'Recorded 2026-10-10. New shared content.');
    const result = { results: applyPermitQaqcHarnessPreview(previewPermitQaqcHarness(item), {confirmed:true}) };
    expect(result.results.find((entry: {relativePath: string})=>entry.relativePath===REFERENCE_PATH.replaceAll('\\','/'))?.status).toBe('conflict');
    expect(fs.readFileSync(target,'utf8')).toBe('A human-owned reference.');
  });

  it("requires a new preview if the shared source changes before confirmation", () => {
    const item = fixture(null);
    const file = sharedGuidance(item,'Recorded 2026-10-09. Reviewed source.');
    const preview = previewPermitQaqcHarness(item);
    fs.writeFileSync(file,'Changed after preview.');
    expect(()=>applyPermitQaqcHarnessPreview(preview,{confirmed:true})).toThrow(/Preview the workspace again/);
    expect(fs.existsSync(preview.harnessRoot)).toBe(false);
  });

  it("does not follow the shared source through a junction outside the configured Dropbox root", () => {
    const item = fixture(null);
    const outside = path.join(path.dirname(item.dropboxRoot),'outside-reference');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside,'CHICAGO-PERMIT-APPLICATION-GUIDANCE.md'),'Must not read outside the configured root.');
    fs.mkdirSync(path.join(item.dropboxRoot,'1.00 PROJECTS'));
    fs.symlinkSync(outside,path.join(item.dropboxRoot,'1.00 PROJECTS','PERMIT QAQC'),'junction');
    const preview = previewPermitQaqcHarness(item);
    expect(preview.desired.get(REFERENCE_PATH)).toContain('bundled authorized snapshot');
    expect(preview.desired.get(REFERENCE_PATH)).not.toContain('Must not read outside');
  });

  it("rejects a reference destination redirected after preview without writing any files", () => {
    const item = fixture(null);
    const preview = previewPermitQaqcHarness(item);
    const outside = path.join(path.dirname(item.dropboxRoot),'other-engagement');
    fs.mkdirSync(outside);
    fs.mkdirSync(preview.harnessRoot);
    fs.symlinkSync(outside,path.join(preview.harnessRoot,'references'),'junction');
    expect(()=>applyPermitQaqcHarnessPreview(preview,{confirmed:true})).toThrow(/inside this engagement/);
    expect(()=>previewPermitQaqcHarness(item)).toThrow(/inside this engagement/);
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(fs.existsSync(path.join(preview.harnessRoot,'AGENTS.md'))).toBe(false);
  });

  it("lists rounds and sibling Dropbox folders in ENGAGEMENT.md", () => {
    const item = fixture(null);
    fs.mkdirSync(path.join(item.engagementDirectory, "Received"), { recursive: true });
    fs.writeFileSync(path.join(item.engagementDirectory, "cover-letter.pdf"), "pdf\n", "utf8");

    const preview = previewPermitQaqcHarness(item);
    applyPermitQaqcHarnessPreview(preview, { confirmed: true });
    const engagementDoc = fs.readFileSync(path.join(item.engagementDirectory, "Mi", "ENGAGEMENT.md"), "utf8");

    expect(engagementDoc).toContain("## Rounds so far");
    expect(engagementDoc).toContain("Round 1 — received 2026-06-18 — response sent 2026-06-20");
    expect(engagementDoc).toContain("## This engagement's Dropbox folder");
    expect(engagementDoc).toContain("Received/");
    expect(engagementDoc).toContain("cover-letter.pdf");
  });

  it("leaves a hand-edited generated file as a conflict instead of overwriting it", () => {
    const item = fixture(null);
    const first = previewPermitQaqcHarness(item);
    applyPermitQaqcHarnessPreview(first, { confirmed: true });
    const agentsPath = path.join(item.engagementDirectory, "Mi", "AGENTS.md");
    fs.writeFileSync(agentsPath, "Partner hand-edited this.\n", "utf8");

    const stale = previewPermitQaqcHarness(item);
    const results = applyPermitQaqcHarnessPreview(stale, { confirmed: true });
    expect(results.find((entry: { relativePath: string }) => entry.relativePath === "AGENTS.md")?.status)
      .toBe("conflict");
    expect(fs.readFileSync(agentsPath, "utf8")).toBe("Partner hand-edited this.\n");
  });

  it("generates the workspace in one pass so a terminal can open without a manual repair", () => {
    const item = fixture(null);
    const { harnessRoot } = ensurePermitQaqcHarness(item);
    expect(harnessRoot).toBe(path.join(item.engagementDirectory, "Mi"));
    expect(fs.existsSync(path.join(harnessRoot, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(harnessRoot, "CLAUDE.md"))).toBe(true);
  });

  it("writes nothing on a repeat pass, so opening a terminal twice leaves no backup churn", () => {
    const item = fixture(null);
    ensurePermitQaqcHarness(item);
    const harnessRoot = path.join(item.engagementDirectory, "Mi");
    const before = fs.statSync(path.join(harnessRoot, "ENGAGEMENT.md")).mtimeMs;

    const { results } = ensurePermitQaqcHarness({ ...item, synchronizedAt: "2026-08-04T12:00:00.000Z" });
    expect(results).toEqual([]);
    expect(fs.statSync(path.join(harnessRoot, "ENGAGEMENT.md")).mtimeMs).toBe(before);
    expect(fs.existsSync(path.join(harnessRoot, ".mi-backups"))).toBe(false);
  });

  it("leaves received evidence untouched and hand-edited files intact when generating unattended", () => {
    const item = fixture("1.00 PROJECTS/Alpha");
    const engagementRoot = path.join(item.dropboxRoot, "1.00 PROJECTS", "Alpha");
    fs.mkdirSync(path.join(engagementRoot, "Received"), { recursive: true });
    fs.writeFileSync(path.join(engagementRoot, "Received", "plans.pdf"), "received drawings\n", "utf8");

    ensurePermitQaqcHarness(item);
    const agentsPath = path.join(engagementRoot, "Mi", "AGENTS.md");
    fs.writeFileSync(agentsPath, "Partner hand-edited this.\n", "utf8");
    // Close the engagement out, so this pass has real generated context to write and can't be
    // short-circuited as already settled.
    fs.writeFileSync(
      path.join(item.engagementDirectory, "qaqc.yaml"),
      [
        "name: Demo Engagement",
        "submitting_firm: SampleConsultant",
        "status: complete",
        "engagement_number: '03'",
        `dropbox_path: ${JSON.stringify("1.00 PROJECTS/Alpha")}`,
        "rounds: []",
      ].join("\n"),
    );

    const { results } = ensurePermitQaqcHarness({ ...item, synchronizedAt: "2026-08-04T12:00:00.000Z" });
    expect(results.find((entry: { relativePath: string }) => entry.relativePath === "AGENTS.md")?.status)
      .toBe("conflict");
    expect(fs.readFileSync(agentsPath, "utf8")).toBe("Partner hand-edited this.\n");
    expect(fs.readFileSync(path.join(engagementRoot, "Received", "plans.pdf"), "utf8")).toBe("received drawings\n");
    expect(fs.existsSync(path.join(item.engagementDirectory, "Mi"))).toBe(false);
  });
});
