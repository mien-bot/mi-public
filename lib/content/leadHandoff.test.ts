import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { leadSchema, type Lead } from "@/lib/schema";
import { applyLeadHandoff, buildLeadHandoffMarkdown, planLeadHandoff } from "./leadHandoff";
import { PROJECT_WORKFLOW_PROFILES } from "./projectCreationPlan";

const ARCHITECTURE_FOLDERS = [...PROJECT_WORKFLOW_PROFILES.architecture.dropboxFolders];

let leadsDir: string;
let projectDir: string;
const roots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-lead-handoff-"));
  roots.push(root);
  return root;
}

function writeYaml(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function lead(overrides: Partial<Lead> = {}): Lead {
  return leadSchema.parse({
    name: "Acme Clinic",
    source: "referral",
    contact_name: "Dana Reed",
    contact_email: "dana@example.com",
    contact_phone: "555-0100",
    referrer_name: "Pat Taylor",
    date_received: "2026-05-04",
    status: "proposal-sent",
    estimated_value: 42000,
    notes: "Wants the waiting room reworked first.",
    contract_stage: "sent",
    contract_notes: "Fee split across two phases.",
    dropbox_path: "1.00 PROJECTS/Old Lead Folder",
    ...overrides,
  });
}

beforeEach(() => {
  leadsDir = temporaryRoot();
  projectDir = temporaryRoot();
  const root = path.join(leadsDir, "acme-clinic");

  fs.mkdirSync(path.join(root, "site-photos"), { recursive: true });
  fs.writeFileSync(path.join(root, "site-photos", "front.jpg"), "front-photo-bytes", "utf8");
  writeYaml(
    path.join(root, "site-photos", "index.yaml"),
    "- file: front.jpg\n  caption: Front elevation\n  added_date: \"2026-05-05\"\n",
  );

  fs.mkdirSync(path.join(root, "owner-supplied"), { recursive: true });
  fs.writeFileSync(path.join(root, "owner-supplied", "survey.pdf"), "survey", "utf8");
  writeYaml(
    path.join(root, "owner-supplied", "index.yaml"),
    "- file: survey.pdf\n  title: Existing survey\n  added_date: \"2026-05-06\"\n",
  );

  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  fs.writeFileSync(path.join(root, "contracts", "draft.docx"), "draft", "utf8");
  writeYaml(
    path.join(root, "contracts", "index.yaml"),
    "- file: draft.docx\n  title: Agreement draft\n  added_date: \"2026-05-07\"\n",
  );

  writeYaml(
    path.join(root, "site-visits", "index.yaml"),
    "- id: v1\n  date: \"2026-05-08\"\n  attendees: [Alex, Dana]\n  notes: Measured the lobby.\n",
  );
  writeYaml(
    path.join(root, "correspondence", "index.yaml"),
    "- id: c1\n  date: \"2026-05-09\"\n  channel: email\n  summary: Sent the fee proposal.\n",
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("planLeadHandoff", () => {
  it("routes each kind of lead file to its profile destination under From-Lead/", () => {
    const plan = planLeadHandoff("acme-clinic", {
      workflow: "architecture",
      folders: ARCHITECTURE_FOLDERS,
      leadsDir,
    });

    expect(plan.copies.map((copy) => copy.target)).toEqual([
      "09_SitePhotos/From-Lead/front.jpg",
      "00_Reference/From-Lead/survey.pdf",
      "01_Admin/From-Lead/draft.docx",
    ]);
    expect(plan.copies[0].bytes).toBe("front-photo-bytes".length);
    expect(plan.totalBytes).toBe("front-photo-bytes".length + "survey".length + "draft".length);
    expect(plan.counts).toMatchObject({ siteVisits: 1, correspondence: 1, meetings: 0, photos: 1 });
  });

  it("falls back to 00_From-Lead when the destination folder was edited out of the list", () => {
    const plan = planLeadHandoff("acme-clinic", {
      workflow: "architecture",
      folders: ARCHITECTURE_FOLDERS.filter((folder) => folder !== "09_SitePhotos"),
      leadsDir,
    });

    expect(plan.copies.find((copy) => copy.kind === "site-photos")?.target)
      .toBe("00_From-Lead/site-photos/front.jpg");
    expect(plan.copies.find((copy) => copy.kind === "contracts")?.target)
      .toBe("01_Admin/From-Lead/draft.docx");
  });

  it("excludes indexed entries that traverse out of the lead folder or are missing on disk", () => {
    writeYaml(
      path.join(leadsDir, "acme-clinic", "owner-supplied", "index.yaml"),
      [
        "- file: ../../escape.pdf",
        "  title: Traversal",
        "  added_date: \"2026-05-06\"",
        "- file: gone.pdf",
        "  title: Deleted after indexing",
        "  added_date: \"2026-05-06\"",
        "",
      ].join("\n"),
    );

    const plan = planLeadHandoff("acme-clinic", {
      workflow: "architecture",
      folders: ARCHITECTURE_FOLDERS,
      leadsDir,
    });

    expect(plan.copies.some((copy) => copy.kind === "owner-supplied")).toBe(false);
    expect(plan.excluded).toEqual([
      { kind: "owner-supplied", source: "owner-supplied/../../escape.pdf", reason: "unsafe" },
      { kind: "owner-supplied", source: "owner-supplied/gone.pdf", reason: "missing" },
    ]);
  });
});

describe("buildLeadHandoffMarkdown", () => {
  it("carries the lead's own record into the brief without inventing anything", () => {
    const plan = planLeadHandoff("acme-clinic", {
      workflow: "architecture",
      folders: ARCHITECTURE_FOLDERS,
      leadsDir,
    });
    const markdown = buildLeadHandoffMarkdown("acme-clinic", lead(), plan, {
      workflow: "architecture",
      folders: ARCHITECTURE_FOLDERS,
      leadsDir,
      projectSlug: "acme-clinic",
      dropboxRelativePath: "1.00 PROJECTS/12_Acme Clinic",
      convertedDate: "2026-08-15",
    });

    expect(markdown).toContain("# Lead handoff — Acme Clinic");
    expect(markdown).toContain("Dana Reed");
    expect(markdown).toContain("Wants the waiting room reworked first.");
    expect(markdown).toContain("Fee split across two phases.");
    expect(markdown).toContain("### 2026-05-08 — Alex, Dana");
    expect(markdown).toContain("Measured the lobby.");
    expect(markdown).toContain("Sent the fee proposal.");
    expect(markdown).toContain("`09_SitePhotos/From-Lead/front.jpg` — Front elevation");
    // The lead's own Dropbox folder is named, never treated as something to copy or move.
    expect(markdown).toContain("1.00 PROJECTS/Old Lead Folder");
    expect(markdown).toContain("left in place");
  });

  it("marks blank fields as unrecorded rather than filling them in", () => {
    const plan = planLeadHandoff("acme-clinic", {
      workflow: "architecture",
      folders: ARCHITECTURE_FOLDERS,
      leadsDir,
    });
    const markdown = buildLeadHandoffMarkdown(
      "acme-clinic",
      lead({ contact_name: "", contact_email: "", estimated_value: null, dropbox_path: null }),
      plan,
      {
        workflow: "architecture",
        folders: ARCHITECTURE_FOLDERS,
        leadsDir,
        projectSlug: "acme-clinic",
        dropboxRelativePath: "1.00 PROJECTS/12_Acme Clinic",
        convertedDate: "2026-08-15",
      },
    );

    expect(markdown).toContain("- **Contact:** _not recorded_");
    expect(markdown).toContain("- **Estimated value:** _not recorded_");
    expect(markdown).toContain("- **Lead Dropbox folder:** _none linked_");
  });
});

describe("applyLeadHandoff", () => {
  it("writes the brief and copies every planned file, leaving the lead's originals in place", () => {
    const plan = planLeadHandoff("acme-clinic", {
      workflow: "architecture",
      folders: ARCHITECTURE_FOLDERS,
      leadsDir,
    });
    const result = applyLeadHandoff("acme-clinic", projectDir, plan, "# brief\n", leadsDir);

    expect(result.written).toEqual([
      "Lead-Handoff.md",
      "09_SitePhotos/From-Lead/front.jpg",
      "00_Reference/From-Lead/survey.pdf",
      "01_Admin/From-Lead/draft.docx",
    ]);
    expect(result.skipped).toEqual([]);
    expect(fs.readFileSync(path.join(projectDir, "Lead-Handoff.md"), "utf8")).toBe("# brief\n");
    expect(fs.readFileSync(path.join(projectDir, "09_SitePhotos", "From-Lead", "front.jpg"), "utf8"))
      .toBe("front-photo-bytes");
    expect(fs.existsSync(path.join(leadsDir, "acme-clinic", "site-photos", "front.jpg"))).toBe(true);
  });

  it("never overwrites a file that is already there", () => {
    const plan = planLeadHandoff("acme-clinic", {
      workflow: "architecture",
      folders: ARCHITECTURE_FOLDERS,
      leadsDir,
    });
    fs.mkdirSync(path.join(projectDir, "09_SitePhotos", "From-Lead"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "09_SitePhotos", "From-Lead", "front.jpg"), "edited by a person", "utf8");
    fs.writeFileSync(path.join(projectDir, "Lead-Handoff.md"), "hand-edited brief", "utf8");

    const result = applyLeadHandoff("acme-clinic", projectDir, plan, "# brief\n", leadsDir);

    expect(result.skipped).toContain("Lead-Handoff.md");
    expect(result.skipped).toContain("09_SitePhotos/From-Lead/front.jpg");
    expect(fs.readFileSync(path.join(projectDir, "09_SitePhotos", "From-Lead", "front.jpg"), "utf8"))
      .toBe("edited by a person");
    expect(fs.readFileSync(path.join(projectDir, "Lead-Handoff.md"), "utf8")).toBe("hand-edited brief");
  });
});
