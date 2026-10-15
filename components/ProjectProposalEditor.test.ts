import { describe, expect, it } from "vitest";
import type { ProjectCopilotProposal } from "@/lib/projectCopilot";
import { validateProjectProposalEdit } from "./ProjectProposalEditor";

const proposal: ProjectCopilotProposal = {
  id: "schedule-review",
  kind: "schedule-item",
  title: "Review",
  reason: "Confirmed planning item.",
  data: {
    name: "Review",
    date: "2026-09-18",
    type: "Internal Meeting",
    start_time: null,
    end_time: null,
  },
};

describe("project proposal editor", () => {
  it("accepts schema-valid value adjustments", () => {
    const adjusted = structuredClone(proposal);
    adjusted.data.start_time = "2026-09-18T14:00:00-05:00";
    adjusted.data.end_time = "2026-09-18T15:00:00-05:00";
    const result = validateProjectProposalEdit(proposal, JSON.stringify(adjusted));
    expect(result.error).toBeUndefined();
    expect(result.proposal).toMatchObject({
      data: { start_time: "2026-09-18T14:00:00-05:00" },
    });
  });

  it("rejects malformed data and identity changes", () => {
    expect(validateProjectProposalEdit(proposal, "{").error).toContain("not valid JSON");
    const wrongDate = structuredClone(proposal);
    wrongDate.data.date = "September 18";
    expect(validateProjectProposalEdit(proposal, JSON.stringify(wrongDate)).error).toContain("data.date");
    const changedId = structuredClone(proposal);
    changedId.id = "different-id";
    expect(validateProjectProposalEdit(proposal, JSON.stringify(changedId)).error).toContain("id and kind are fixed");
  });
});
