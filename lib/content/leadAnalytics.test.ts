import { describe, expect, it } from "vitest";
import type { Lead } from "@/lib/schema";
import { analyzeLeadEvidence } from "./leadAnalytics";

const lead: Lead = {
  name: "Alpha",
  source: "referral",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  referrer_name: "",
  date_received: "2026-06-01",
  status: "qualified",
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

describe("lead analysis", () => {
  it("reports evidence and factual attention gaps without inventing activity", () => {
    const result = analyzeLeadEvidence({
      slug: "alpha",
      lead,
      meetings: [],
      visits: [],
      communications: [],
      sitePhotoCount: 0,
      contractCount: 0,
      ownerSuppliedCount: 0,
      dropboxReachable: true,
      dropboxTree: [{
        name: "Owner Files",
        relativePath: "Owner Files",
        isDirectory: true,
        children: [{
          name: "survey.pdf",
          relativePath: "Owner Files/survey.pdf",
          isDirectory: false,
        }],
      }],
      today: "2026-07-30",
    });

    expect(result.lastRecordedActivity).toBe("2026-06-01");
    expect(result.daysSinceRecordedActivity).toBe(59);
    expect(result.counts.dropboxFiles).toBe(1);
    expect(result.fileTypes).toEqual([{ extension: ".pdf", count: 1 }]);
    expect(result.attentionSignals).toContain("No owner or decision-maker contact is recorded");
    expect(result.missingInformation).toContain("Estimated value");
  });
});
