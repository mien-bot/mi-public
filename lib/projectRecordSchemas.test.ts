import { describe, expect, it } from "vitest";
import {
  projectDecisionSchema,
  projectRecordReferenceSchema,
  projectSiteReportSchema,
} from "./schema";

const conversationSource = {
  kind: "conversation" as const,
  label: "Current conversation (not separately archived)",
  path: null,
  url: null,
  item_id: null,
  source_date: "2026-07-28",
  notes: "",
};

describe("project record schemas", () => {
  it("rejects escaping and absolute source paths", () => {
    expect(projectRecordReferenceSchema.safeParse({
      kind: "project-file",
      label: "Unsafe",
      path: "../secret.md",
    }).success).toBe(false);
    expect(projectRecordReferenceSchema.safeParse({
      kind: "dropbox-file",
      label: "Unsafe",
      path: "C:\\Dropbox\\secret.pdf",
    }).success).toBe(false);
  });

  it("requires an outcome for decided records and a replacement for superseded records", () => {
    const base = {
      version: 1 as const,
      id: "decision-12345678",
      title: "Storefront selection",
      decision_date: "2026-07-28",
      recorded_at: "2026-07-28T18:00:00.000Z",
      confirmed_by: "Alex",
      deciders: [],
      context: "",
      options: [],
      rationale: "",
      consequences: [],
      affected_deliverables: [],
      sources: [conversationSource],
      supersedes: null,
      superseded_by: null,
    };
    expect(projectDecisionSchema.safeParse({ ...base, status: "decided", outcome: "" }).success)
      .toBe(false);
    expect(projectDecisionSchema.safeParse({
      ...base,
      status: "decided",
      outcome: "Use the selected system.",
      confirmed_by: null,
    }).success).toBe(false);
    expect(projectDecisionSchema.safeParse({ ...base, status: "superseded", outcome: "Old" }).success)
      .toBe(false);
    expect(projectDecisionSchema.safeParse({ ...base, status: "proposed", outcome: "" }).success)
      .toBe(true);
  });

  it("preserves site-evidence categories and their required metadata", () => {
    const base = {
      version: 1 as const,
      id: "site-report-12345678",
      title: "Walkthrough",
      status: "draft" as const,
      origin: "manual" as const,
      visit_date: "2026-07-28",
      created_at: "2026-07-28T18:00:00.000Z",
      updated_at: null,
      confirmed_by: null,
      purpose: "",
      scope: "",
      participants: [],
      conditions: {},
      sources: [],
      raw_notes: "",
      professional_review_required: true,
    };
    expect(projectSiteReportSchema.safeParse({
      ...base,
      items: [{
        id: "R1",
        kind: "reported-information",
        text: "Water was reported after rain.",
        attributed_to: null,
      }],
    }).success).toBe(false);
    expect(projectSiteReportSchema.safeParse({
      ...base,
      items: [{
        id: "O1",
        kind: "issue",
        text: "Needs review.",
      }],
    }).success).toBe(false);
    expect(projectSiteReportSchema.safeParse({
      ...base,
      items: [{
        id: "L1",
        kind: "limitation",
        text: "The wall cavity was not observed.",
      }],
    }).success).toBe(true);
  });
});
