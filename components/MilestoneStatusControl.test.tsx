import { describe, expect, it } from "vitest";
import { milestoneStatusPatchBody } from "./MilestoneStatusControl";

describe("milestoneStatusPatchBody", () => {
  it("always sends the reviewed schedule hash, so the route can check for a concurrent edit", () => {
    const body = milestoneStatusPatchBody({
      id: "milestone-1",
      plannedDate: "2026-08-13",
      draft: "complete",
      notionLinked: true,
      scheduleHash: "hash-at-page-load",
      today: "2026-08-16",
    });

    expect("expectedHash" in body).toBe(true);
    expect(body.expectedHash).toBe("hash-at-page-load");
    expect(body.confirmed).toBe(true);
  });

  it("keeps expectedHash present when the schedule file has no hash yet", () => {
    const body = milestoneStatusPatchBody({
      id: "milestone-1",
      plannedDate: "2026-08-13",
      draft: "active",
      notionLinked: false,
      scheduleHash: null,
      today: "2026-08-16",
    });

    expect("expectedHash" in body).toBe(true);
    expect(body.expectedHash).toBeNull();
  });

  it("records today as the completion date only when completing, and trims the planned date", () => {
    const completing = milestoneStatusPatchBody({
      id: "milestone-1",
      plannedDate: "2026-08-13T00:00:00.000Z",
      draft: "complete",
      notionLinked: true,
      scheduleHash: "hash",
      today: "2026-08-16",
    });
    const reopening = milestoneStatusPatchBody({
      id: "milestone-1",
      plannedDate: "2026-08-13T00:00:00.000Z",
      draft: "active",
      notionLinked: true,
      scheduleHash: "hash",
      today: "2026-08-16",
    });

    expect(completing.plannedDate).toBe("2026-08-13");
    expect(completing.actualDate).toBe("2026-08-16");
    expect(reopening.actualDate).toBeNull();
    expect(completing.syncNotion).toBe(true);
  });
});
