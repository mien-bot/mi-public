import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addCommunication,
  addSiteVisit,
  createLead,
  deleteCommunication,
  deleteLead,
  deleteSiteVisit,
  updateLead,
} from "./leadMutations";

const VALID_LEAD = {
  name: "Potential Client",
  source: "referral",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  date_received: "2026-07-26",
  status: "qualified",
  estimated_value: 25000,
  notes: "",
  lost_reason: null,
  converted_project_slug: null,
  converted_date: null,
  dropbox_path: null,
  contract_stage: "not-sent",
};

describe("lead mutations", () => {
  let root: string;
  let leadsDir: string;
  let projectsDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-leads-"));
    leadsDir = path.join(root, "leads");
    projectsDir = path.join(root, "projects");
    fs.mkdirSync(leadsDir);
    fs.mkdirSync(path.join(projectsDir, "confirmed-project"), { recursive: true });
    fs.writeFileSync(path.join(projectsDir, "confirmed-project", "project.yaml"), "name: Confirmed\n");
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("creates an explicitly named, schema-valid lead folder without silently changing its slug", () => {
    const result = createLead("exact-lead", VALID_LEAD, { leadsDir, projectsDir });
    expect(result.slug).toBe("exact-lead");
    expect(fs.existsSync(path.join(leadsDir, "exact-lead", "lead.yaml"))).toBe(true);
    expect(loadYaml(fs.readFileSync(result.filePath, "utf8"))).toMatchObject({ name: "Potential Client" });
    // creation also scaffolds the empty site-visits/correspondence/contracts/site-photos/owner-supplied subfolders
    for (const sub of ["site-visits", "correspondence", "contracts", "site-photos", "owner-supplied"]) {
      expect(fs.existsSync(path.join(leadsDir, "exact-lead", sub, "index.yaml"))).toBe(true);
    }
  });

  it("rejects traversal, reserved slugs, and case-insensitive collisions", () => {
    expect(() => createLead("../outside", VALID_LEAD, { leadsDir, projectsDir })).toThrow(/lowercase/);
    expect(() => createLead("new", VALID_LEAD, { leadsDir, projectsDir })).toThrow(/reserved/);
    fs.mkdirSync(path.join(leadsDir, "EXACT-LEAD"));
    expect(() => createLead("exact-lead", VALID_LEAD, { leadsDir, projectsDir })).toThrow(/already exists/);
  });

  it("requires an exact existing project slug paired with a real conversion date", () => {
    expect(() => createLead("unpaired", {
      ...VALID_LEAD,
      converted_project_slug: "confirmed-project",
    }, { leadsDir, projectsDir })).toThrow(/supplied together/);
    expect(() => createLead("missing-project", {
      ...VALID_LEAD,
      converted_project_slug: "not-a-project",
      converted_date: "2026-07-25",
    }, { leadsDir, projectsDir })).toThrow(/does not exist/);
    expect(() => createLead("bad-date", {
      ...VALID_LEAD,
      date_received: "2026-02-30",
    }, { leadsDir, projectsDir })).toThrow(/real calendar date/);
  });

  it("updates recoverably while preserving unrelated YAML fields", () => {
    createLead("exact-lead", VALID_LEAD, { leadsDir, projectsDir });
    const filePath = path.join(leadsDir, "exact-lead", "lead.yaml");
    fs.writeFileSync(filePath, fs.readFileSync(filePath, "utf8") + "future_field: keep-me\n");

    const result = updateLead("exact-lead", {
      ...VALID_LEAD,
      name: "Updated Client",
    }, { leadsDir, projectsDir });
    const written = loadYaml(fs.readFileSync(result.filePath, "utf8")) as Record<string, unknown>;
    expect(written.name).toBe("Updated Client");
    expect(written.future_field).toBe("keep-me");
    expect(result.backupPath).not.toBeNull();
    expect(fs.existsSync(result.backupPath!)).toBe(true);
    // backups now live per-lead, not in one firm-wide folder
    expect(result.backupPath).toContain(path.join("exact-lead", ".mi-backups"));
  });

  it("deletes only after exact confirmation and backs up the whole lead folder recoverably", () => {
    createLead("exact-lead", VALID_LEAD, { leadsDir, projectsDir });
    addSiteVisit("exact-lead", { id: "v1", date: "2026-07-20", attendees: ["Alex"], notes: "Walkthrough" }, { leadsDir });

    expect(() => deleteLead("exact-lead", {
      confirmed: false,
      expectedName: VALID_LEAD.name,
    }, { leadsDir, projectsDir })).toThrow(/confirmation/);
    expect(() => deleteLead("exact-lead", {
      confirmed: true,
      expectedName: "Different Lead",
    }, { leadsDir, projectsDir })).toThrow(/changed/);
    expect(fs.existsSync(path.join(leadsDir, "exact-lead"))).toBe(true);

    const result = deleteLead("exact-lead", {
      confirmed: true,
      expectedName: VALID_LEAD.name,
    }, { leadsDir, projectsDir });

    expect(fs.existsSync(result.filePath)).toBe(false);
    expect(fs.existsSync(result.backupPath)).toBe(true);
    // the whole folder (including the site visit) is recoverable, not just lead.yaml
    expect(loadYaml(fs.readFileSync(path.join(result.backupPath, "lead.yaml"), "utf8"))).toMatchObject({
      name: VALID_LEAD.name,
    });
    expect(fs.existsSync(path.join(result.backupPath, "site-visits", "index.yaml"))).toBe(true);
  });

  it("appends site visits and correspondence without touching prior entries", () => {
    createLead("exact-lead", VALID_LEAD, { leadsDir, projectsDir });

    expect(() => addSiteVisit("missing-lead", { id: "v1", date: "2026-07-20" }, { leadsDir }))
      .toThrow(/was not found/);

    const first = addSiteVisit("exact-lead", { id: "v1", date: "2026-07-20", attendees: ["Alex"], notes: "" }, { leadsDir });
    const second = addSiteVisit("exact-lead", { id: "v2", date: "2026-07-25", attendees: [], notes: "Follow-up" }, { leadsDir });
    const index = loadYaml(
      fs.readFileSync(path.join(leadsDir, "exact-lead", "site-visits", "index.yaml"), "utf8"),
    ) as unknown[];
    expect(index).toHaveLength(2);
    expect(first.id).toBe("v1");
    expect(second.id).toBe("v2");

    const comm = addCommunication(
      "exact-lead",
      { id: "c1", date: "2026-07-21", channel: "call", summary: "Discussed scope" },
      { leadsDir },
    );
    expect(comm.channel).toBe("call");
    const commIndex = loadYaml(
      fs.readFileSync(path.join(leadsDir, "exact-lead", "correspondence", "index.yaml"), "utf8"),
    ) as unknown[];
    expect(commIndex).toHaveLength(1);
  });

  it("deletes only the confirmed site visit and preserves a recoverable index backup", () => {
    createLead("exact-lead", VALID_LEAD, { leadsDir, projectsDir });
    addSiteVisit("exact-lead", { id: "v1", date: "2026-07-20", attendees: ["Alex"], notes: "First" }, { leadsDir });
    addSiteVisit("exact-lead", { id: "v2", date: "2026-07-25", attendees: ["Taylor"], notes: "Second" }, { leadsDir });

    expect(() => deleteSiteVisit("exact-lead", "v1", {
      confirmed: false,
      expectedDate: "2026-07-20",
    }, { leadsDir })).toThrow(/confirmation/);
    expect(() => deleteSiteVisit("exact-lead", "v1", {
      confirmed: true,
      expectedDate: "2026-07-21",
    }, { leadsDir })).toThrow(/changed/);

    const result = deleteSiteVisit("exact-lead", "v1", {
      confirmed: true,
      expectedDate: "2026-07-20",
    }, { leadsDir });
    const remaining = loadYaml(fs.readFileSync(result.filePath, "utf8")) as Array<{ id: string }>;
    const backup = loadYaml(fs.readFileSync(result.backupPath!, "utf8")) as Array<{ id: string }>;

    expect(result.visit.id).toBe("v1");
    expect(remaining.map((visit) => visit.id)).toEqual(["v2"]);
    expect(backup.map((visit) => visit.id)).toEqual(["v1", "v2"]);
  });
});

describe("correspondence deletion", () => {
  let root: string;
  let leadsDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-lead-correspondence-"));
    leadsDir = path.join(root, "leads");
    fs.mkdirSync(leadsDir, { recursive: true });
    createLead("exact-lead", VALID_LEAD, { leadsDir, projectsDir: path.join(root, "projects") });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("removes only the named entry and leaves the rest of the log", () => {
    addCommunication("exact-lead", { id: "c1", date: "2026-07-21", channel: "call", summary: "Scope call" }, { leadsDir });
    addCommunication("exact-lead", { id: "c2", date: "2026-07-22", channel: "email", summary: "Fee note" }, { leadsDir });

    const removed = deleteCommunication("exact-lead", "c1", { leadsDir });

    expect(removed.summary).toBe("Scope call");
    const remaining = loadYaml(
      fs.readFileSync(path.join(leadsDir, "exact-lead", "correspondence", "index.yaml"), "utf8"),
    ) as { id: string }[];
    expect(remaining.map((entry) => entry.id)).toEqual(["c2"]);
  });

  it("reports an unknown entry rather than rewriting the log", () => {
    addCommunication("exact-lead", { id: "c1", date: "2026-07-21", channel: "call", summary: "Scope call" }, { leadsDir });
    expect(() => deleteCommunication("exact-lead", "nope", { leadsDir })).toThrow(/was not found/);
    const remaining = loadYaml(
      fs.readFileSync(path.join(leadsDir, "exact-lead", "correspondence", "index.yaml"), "utf8"),
    ) as { id: string }[];
    expect(remaining).toHaveLength(1);
  });
});
