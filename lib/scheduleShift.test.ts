import { describe, expect, it } from "vitest";
import { daysBetween, endAfterMove, shiftByDays } from "./scheduleShift";

describe("moving Notion dates", () => {
  it("counts days across a month end", () => {
    expect(daysBetween("2026-08-30", "2026-09-02")).toBe(3);
    expect(daysBetween("2026-09-02", "2026-08-30")).toBe(-3);
  });

  it("keeps the clock time and offset of a timestamp", () => {
    expect(shiftByDays("2026-08-16T10:30:00.000-05:00", 3)).toBe("2026-08-19T10:30:00.000-05:00");
    expect(shiftByDays("2026-08-16", -20)).toBe("2026-07-27");
  });

  it("keeps an event's length when its start moves", () => {
    expect(endAfterMove("2026-08-16T10:00:00.000-05:00", "2026-08-16T11:30:00.000-05:00", "2026-08-20T14:00:00.000-05:00"))
      .toBe("2026-08-20T20:30:00.000Z");
  });
});
