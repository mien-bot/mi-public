import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLastSiteVisitDate, getLeadSlugs, getSiteVisits } from "./leads";

describe("lead readers", () => {
  let root: string;
  let leadsDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-leads-read-"));
    leadsDir = path.join(root, "leads");
    fs.mkdirSync(path.join(leadsDir, "a-lead", "site-visits"), { recursive: true });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("lists lead slugs as directories, not files", () => {
    fs.mkdirSync(path.join(leadsDir, "b-lead"));
    expect(getLeadSlugs(leadsDir).sort()).toEqual(["a-lead", "b-lead"]);
  });

  it("returns no last-visit date when no site visits are logged yet", () => {
    fs.writeFileSync(path.join(leadsDir, "a-lead", "site-visits", "index.yaml"), "[]\n");
    expect(getSiteVisits("a-lead", leadsDir)).toEqual([]);
    expect(getLastSiteVisitDate("a-lead", leadsDir)).toBeNull();
  });

  it("computes the most recent site visit date out of several, regardless of entry order", () => {
    fs.writeFileSync(
      path.join(leadsDir, "a-lead", "site-visits", "index.yaml"),
      [
        "- id: v1",
        "  date: '2026-07-10'",
        "  attendees: []",
        "  notes: ''",
        "- id: v2",
        "  date: '2026-07-25'",
        "  attendees: []",
        "  notes: ''",
        "- id: v3",
        "  date: '2026-07-18'",
        "  attendees: []",
        "  notes: ''",
        "",
      ].join("\n"),
    );
    expect(getLastSiteVisitDate("a-lead", leadsDir)).toBe("2026-07-25");
  });
});
