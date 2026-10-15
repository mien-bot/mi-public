import { describe, expect, it } from "vitest";
import type { NotionScheduleEntry } from "@/src/adapters/notion/schedule";
import { planMilestoneChanges } from "./notionSync";

function entry(overrides: Partial<NotionScheduleEntry> = {}): NotionScheduleEntry {
  return {
    id: "event-1",
    url: null,
    name: "Permit set",
    date: "2026-08-10",
    doDate: null,
    completedDate: null,
    status: "Done",
    type: ["Deadline"],
    hours: null,
    attendees: [],
    ...overrides,
  };
}

describe("Notion milestone completion pull", () => {
  const schedule = (actualDate: string | null) => ({
    milestones: [{
      id: "milestone-1",
      name: "Permit set",
      planned_date: "2026-08-10",
      actual_date: actualDate,
      notion_event_id: "event-1",
      sync_key: null,
    }],
  });

  it("uses Notion Completed Date when Status is Done", () => {
    const result = planMilestoneChanges(
      schedule(null),
      [entry({ completedDate: "2026-07-25" })],
      "2026-07-26",
    );
    expect(result.updatedMilestones[0].actual_date).toBe("2026-07-25");
  });

  it("uses the first observed date when Done has no Completed Date", () => {
    const result = planMilestoneChanges(schedule(null), [entry()], "2026-07-26");
    expect(result.updatedMilestones[0].actual_date).toBe("2026-07-26");
  });

  it("clears the local completion when Notion is reopened", () => {
    const result = planMilestoneChanges(
      schedule("2026-07-25"),
      [entry({ status: "In progress" })],
      "2026-07-26",
    );
    expect(result.updatedMilestones[0].actual_date).toBeNull();
  });
});
