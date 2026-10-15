import { describe, expect, it } from "vitest";
import { buildLeadReadiness, buildProjectReadiness } from "./operationsReadiness";

describe("operations readiness", () => {
  it("keeps external links missing until they are explicitly confirmed", () => {
    const items = buildProjectReadiness({
      dropboxLinked: false,
      notionLinked: false,
      scopeConfirmed: true,
      phaseCount: 2,
      contractCount: 1,
      primaryContractLinked: false,
      meetingCount: 0,
      milestoneCount: 2,
      reviewEvidenceCount: 0,
    });

    expect(items.find((item) => item.id === "shared-files")?.state).toBe("missing");
    expect(items.find((item) => item.id === "schedule")?.state).toBe("attention");
    expect(items.find((item) => item.id === "commercial")?.state).toBe("ready");
  });

  it("counts meeting evidence, and holds attention while a meeting question still blocks", () => {
    const base = {
      dropboxLinked: true,
      notionLinked: true,
      hasContact: true,
      hasEstimate: true,
      contractStage: "sent" as const,
      contractCount: 1,
      siteVisitCount: 0,
      communicationCount: 0,
      meetingCount: 0,
      blockingQuestionCount: 0,
    };

    // A lead with no site visit but two recorded meetings is no longer indistinguishable
    // from one where nothing has happened.
    const untouched = buildLeadReadiness(base).find((item) => item.id === "site-meeting");
    const withMeetings = buildLeadReadiness({ ...base, meetingCount: 2 })
      .find((item) => item.id === "site-meeting");
    expect(untouched?.state).toBe("attention");
    expect(withMeetings?.state).toBe("ready");
    expect(withMeetings?.detail).toContain("2 meeting(s)");

    const blocked = buildLeadReadiness({ ...base, meetingCount: 2, blockingQuestionCount: 2 })
      .find((item) => item.id === "site-meeting");
    expect(blocked?.state).toBe("attention");
    expect(blocked?.detail).toContain("2 blocking question(s)");
  });

  it("distinguishes an active contract negotiation from a signed lead contract", () => {
    const common = {
      dropboxLinked: true,
      notionLinked: true,
      hasContact: true,
      hasEstimate: true,
      contractCount: 2,
      siteVisitCount: 1,
      communicationCount: 3,
      meetingCount: 0,
      blockingQuestionCount: 0,
    };
    const negotiation = buildLeadReadiness({
      ...common,
      contractStage: "under-negotiation",
    });
    const signed = buildLeadReadiness({
      ...common,
      contractStage: "signed",
    });

    expect(negotiation.find((item) => item.id === "lead-contract")?.state).toBe("attention");
    expect(signed.find((item) => item.id === "lead-contract")?.state).toBe("ready");
  });
});
