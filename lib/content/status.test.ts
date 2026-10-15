import { describe, expect, it } from "vitest";
import { computeBudgetStatus, computeMilestoneStatus } from "./status";

const today = new Date("2026-07-25T00:00:00Z");

describe("computeMilestoneStatus", () => {
  it("is complete whenever actual_date is set, even if planned_date is in the past", () => {
    expect(
      computeMilestoneStatus({ planned_date: "2026-01-01", actual_date: "2026-01-05" }, today),
    ).toBe("complete");
  });

  it("is overdue when planned_date is in the past with no actual_date", () => {
    expect(computeMilestoneStatus({ planned_date: "2026-07-01", actual_date: null }, today)).toBe(
      "overdue",
    );
  });

  it("is at-risk when planned_date is today (0 days out)", () => {
    expect(computeMilestoneStatus({ planned_date: "2026-07-25", actual_date: null }, today)).toBe(
      "at-risk",
    );
  });

  it("is at-risk at the 14-day boundary (inclusive)", () => {
    expect(computeMilestoneStatus({ planned_date: "2026-08-08", actual_date: null }, today)).toBe(
      "at-risk",
    );
  });

  it("is on-track just past the 14-day boundary", () => {
    expect(computeMilestoneStatus({ planned_date: "2026-08-09", actual_date: null }, today)).toBe(
      "on-track",
    );
  });

  it("is on-track for a planned_date far in the future", () => {
    expect(computeMilestoneStatus({ planned_date: "2027-01-01", actual_date: null }, today)).toBe(
      "on-track",
    );
  });
});

describe("computeBudgetStatus", () => {
  it("is on-track when actual is well under budgeted", () => {
    expect(computeBudgetStatus({ budgeted: 100000, actual: 50000 })).toBe("on-track");
  });

  it("is warning at the 90% threshold (inclusive)", () => {
    expect(computeBudgetStatus({ budgeted: 100000, actual: 90000 })).toBe("warning");
  });

  it("is on-track just under the 90% threshold", () => {
    expect(computeBudgetStatus({ budgeted: 100000, actual: 89999 })).toBe("on-track");
  });

  it("is over once actual exceeds budgeted", () => {
    expect(computeBudgetStatus({ budgeted: 100000, actual: 100001 })).toBe("over");
  });

  it("treats a zero budget with zero actual as on-track", () => {
    expect(computeBudgetStatus({ budgeted: 0, actual: 0 })).toBe("on-track");
  });

  it("treats a zero budget with any actual spend as over", () => {
    expect(computeBudgetStatus({ budgeted: 0, actual: 1 })).toBe("over");
  });
});
