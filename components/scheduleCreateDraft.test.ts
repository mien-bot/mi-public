import { describe, expect, it } from "vitest";
import {
  buildCalendarScheduleProposal,
  localDateTimeWithOffset,
  scheduleProjectOptions,
} from "./scheduleCreateDraft";

const PAGE_ID = "abc12345abc12345abc12345abc12345";

describe("calendar schedule creation", () => {
  it("keeps only projects with exact confirmed Notion page ids", () => {
    expect(scheduleProjectOptions({ projects: [
      { notionPageId: PAGE_ID, name: "example" },
      { notionPageId: "", name: "Local only" },
      { notionPageId: "invented", name: "Invalid" },
    ] })).toEqual([{ notionPageId: PAGE_ID, name: "example" }]);
  });

  it("preserves the selected local date and time while adding an explicit offset", () => {
    expect(localDateTimeWithOffset("2026-08-10", "09:30"))
      .toMatch(/^2026-08-10T09:30:00[+-]\d{2}:\d{2}$/);
  });

  it("builds a validated project-linked proposal with optional times", () => {
    const proposal = buildCalendarScheduleProposal({
      name: "Client meeting",
      date: "2026-08-10",
      type: "Client Meeting",
      startTime: "09:30",
      endTime: "10:30",
      project: { notionPageId: PAGE_ID, name: "example" },
    });
    expect(proposal).toMatchObject({
      kind: "schedule-create",
      data: {
        name: "Client meeting",
        projectPageId: PAGE_ID,
        projectName: "example",
      },
    });
    if (proposal.kind === "schedule-create") {
      expect(proposal.data.startTime).toContain("T09:30:00");
      expect(proposal.data.endTime).toContain("T10:30:00");
    }
  });

  it("uses a fresh idempotency id for every create and preserves selected attendees", () => {
    const input = {
      name: "Coordination",
      date: "2026-08-10",
      type: "Meeting" as const,
      startTime: "",
      endTime: "",
      project: null,
      attendees: [{ id: PAGE_ID, name: "Example User" }],
    };
    const first = buildCalendarScheduleProposal(input);
    const second = buildCalendarScheduleProposal(input);
    expect(first.id).not.toBe(second.id);
    if (first.kind === "schedule-create") expect(first.data.attendeeIds).toEqual([PAGE_ID]);
  });

  it("uses the selected calendar timezone instead of the computer timezone", () => {
    const proposal = buildCalendarScheduleProposal({
      name: "Chicago meeting",
      date: "2026-08-10",
      type: "Meeting",
      startTime: "09:30",
      endTime: "10:30",
      project: null,
      timezone: "America/Chicago",
    });
    expect(proposal).toMatchObject({
      kind: "schedule-create",
      data: {
        startTime: "2026-08-10T09:30:00.000-05:00",
        endTime: "2026-08-10T10:30:00.000-05:00",
      },
    });
  });

  it("rejects an end time without a start time", () => {
    expect(() => buildCalendarScheduleProposal({
      name: "Meeting",
      date: "2026-08-10",
      type: "Meeting",
      startTime: "",
      endTime: "10:30",
      project: null,
    })).toThrow(/start time/i);
  });
});
