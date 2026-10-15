import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSiteReport } from "@/lib/schema";

const roots: string[] = [];
let projectDir: string;

vi.mock("./projects", () => ({ contentDir: () => projectDir }));

import { ContentConflictError } from "./atomicContentWrite";
import {
  createProjectSiteReport,
  deleteProjectSiteReport,
  getProjectSiteReports,
  updateProjectSiteReport,
} from "./projectSiteReports";

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-site-reports-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function report(overrides: Partial<ProjectSiteReport> = {}): ProjectSiteReport {
  return {
    version: 1,
    id: "site-report-12345678",
    title: "Existing storefront walkthrough",
    status: "draft",
    origin: "manual",
    visit_date: "2026-07-28",
    created_at: "2026-07-28T18:00:00.000Z",
    updated_at: null,
    confirmed_by: null,
    purpose: "Existing-condition observation.",
    scope: "Visible public areas.",
    participants: [{ name: "Owner", role: "Client" }],
    conditions: {
      weather: "Clear",
      access: "Public areas only",
      lighting: "",
      occupancy: "",
      active_work: "",
    },
    sources: [],
    items: [{
      id: "O1",
      kind: "direct-observation",
      location: "North storefront",
      text: "Visible sealant separation at the lower frame.",
      attributed_to: null,
      source_refs: [],
      photo_refs: [{
        kind: "dropbox-file",
        label: "IMG_1024",
        path: "02_Site/Photos/IMG_1024.jpg",
        url: null,
        item_id: null,
        source_date: null,
        notes: "",
      }],
      owner: null,
      due_date: null,
    }],
    raw_notes: "Observed from the sidewalk.",
    professional_review_required: true,
    ...overrides,
  };
}

describe("project site reports", () => {
  it("creates and reloads a categorized, disclaimer-bearing report", () => {
    projectDir = temporaryRoot();
    const created = createProjectSiteReport("demo", report());
    const raw = fs.readFileSync(path.join(projectDir, created.relativePath), "utf8");

    expect(raw).toContain("## Direct observations");
    expect(raw).toContain("Professional review required");
    expect(getProjectSiteReports("demo")[0].report.items[0].kind).toBe("direct-observation");
  });

  it("requires the displayed hash for revision", () => {
    projectDir = temporaryRoot();
    const created = createProjectSiteReport("demo", report());

    expect(() => updateProjectSiteReport(
      "demo",
      created.report.id,
      { ...created.report, scope: "Revised scope.", updated_at: "2026-07-28T19:00:00.000Z" },
      "stale-hash",
    )).toThrow(ContentConflictError);
  });
});

describe("site report deletion", () => {
  it("removes the record but keeps a recoverable copy, and refuses a stale hash", () => {
    projectDir = temporaryRoot();
    const created = createProjectSiteReport("demo", report());

    expect(() => deleteProjectSiteReport("demo", created.report.id, "stale-hash"))
      .toThrow(ContentConflictError);
    expect(getProjectSiteReports("demo")).toHaveLength(1);

    const { backupPath } = deleteProjectSiteReport("demo", created.report.id, created.hash);
    expect(getProjectSiteReports("demo")).toHaveLength(0);
    expect(fs.existsSync(backupPath)).toBe(true);
  });

  it("reports an unknown id rather than deleting something else", () => {
    projectDir = temporaryRoot();
    createProjectSiteReport("demo", report());
    expect(() => deleteProjectSiteReport("demo", "site-report-99999999", "hash"))
      .toThrow(/was not found/);
    expect(getProjectSiteReports("demo")).toHaveLength(1);
  });
});
