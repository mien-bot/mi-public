import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Lead } from "@/lib/schema";
import type { NotionLeadEntry } from "@/src/adapters/notion/leads";
import { planLeadNotionChanges, scanLeadDropboxInventory } from "./leadSync";

const roots: string[] = [];

const lead: Lead = {
  name: "Alpha",
  source: "referral",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  referrer_name: "",
  date_received: "2026-07-01",
  status: "new",
  estimated_value: null,
  notes: "",
  lost_reason: null,
  converted_project_slug: null,
  converted_date: null,
  dropbox_path: "1.01 LEADS/Alpha",
  contract_stage: "not-sent",
  contract_notes: "",
  notion_page_id: "notion-alpha",
};

function notion(overrides: Partial<NotionLeadEntry> = {}): NotionLeadEntry {
  return {
    id: "notion-alpha",
    url: "https://www.notion.so/notion-alpha",
    name: "Alpha",
    source: "referral",
    status: "qualified",
    contactName: "Owner",
    contactEmail: "owner@example.com",
    contactPhone: null,
    dateReceived: "2026-07-01",
    estimatedValue: 50_000,
    notes: "Added in Notion",
    lostReason: "",
    convertedDate: null,
    convertedProjectPageIds: [],
    dropboxPath: "1.01 LEADS/Different",
    contractStage: "sent",
    contractNotes: "Draft shared",
    meetingNotes: "",
    referrerName: "Architect",
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("lead source synchronization", () => {
  it("plans allowlisted Notion fields but keeps confirmed identity links review-only", () => {
    const result = planLeadNotionChanges(lead, notion());
    expect(result.nextLead).toMatchObject({
      status: "qualified",
      contact_name: "Owner",
      contact_email: "owner@example.com",
      estimated_value: 50_000,
      contract_stage: "sent",
    });
    expect(result.nextLead.dropbox_path).toBe("1.01 LEADS/Alpha");
    expect(result.changes).toContainEqual(expect.objectContaining({
      field: "dropbox_path",
      allowed: false,
      to: "1.01 LEADS/Different",
    }));
  });

  it("keeps Notion conversion relations and aggregated meeting prose review-only", () => {
    const result = planLeadNotionChanges(lead, notion({
      convertedDate: "2026-07-30",
      convertedProjectPageIds: ["project-page"],
      meetingNotes: "A Notion-only note",
    }));
    expect(result.changes).toContainEqual(expect.objectContaining({ field: "converted_project", allowed: false }));
    expect(result.changes).toContainEqual(expect.objectContaining({ field: "meeting_notes", allowed: false }));
    expect(result.nextLead.converted_project_slug).toBeNull();
  });

  it("builds a bounded metadata inventory without reading file contents or following symlinks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-lead-sync-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "Owner Files"), { recursive: true });
    fs.writeFileSync(path.join(root, "Owner Files", "survey.pdf"), "private content");
    fs.writeFileSync(path.join(root, "notes.txt"), "more private content");

    const result = scanLeadDropboxInventory(root);
    expect(result.truncated).toBe(false);
    expect(result.items.map((item) => item.path)).toEqual([
      "notes.txt",
      "Owner Files",
      "Owner Files/survey.pdf",
    ]);
    expect(result.items.find((item) => item.path === "Owner Files/survey.pdf")?.size_bytes).toBe(15);
    expect(result.items.every((item) => !Object.hasOwn(item, "content"))).toBe(true);
  });
});
