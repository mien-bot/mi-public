import { describe, expect, it } from "vitest";
import {
  canonicalTimestampInTimezone,
  dateInTimezone,
  formatNotionTimestamp,
  localDateTimeToCanonical,
  timeInTimezone,
} from "./timezone";

describe("project timezone handling", () => {
  it("uses CST in winter and CDT in summer", () => {
    expect(localDateTimeToCanonical("2026-01-15", "10:00", "America/Chicago"))
      .toBe("2026-01-15T10:00:00.000-06:00");
    expect(localDateTimeToCanonical("2026-07-17", "15:03", "America/Chicago"))
      .toBe("2026-07-17T15:03:00.000-05:00");
  });

  it("displays the existing Riya Meeting timestamp in Chicago", () => {
    expect(formatNotionTimestamp("2026-07-17T20:03:00.000Z", "America/Chicago"))
      .toContain("3:03 PM");
  });

  it("does not shift date-only values", () => {
    expect(formatNotionTimestamp("2026-07-17", "Pacific/Auckland")).toBe("2026-07-17");
  });

  it("uses the selected timezone when choosing today's completion date", () => {
    const instant = new Date("2026-07-27T02:30:00.000Z");
    expect(dateInTimezone(instant, "America/Chicago")).toBe("2026-07-26");
    expect(dateInTimezone(instant, "Pacific/Auckland")).toBe("2026-07-27");
  });

  it("formats wall-clock time and canonical offsets for an existing instant", () => {
    const instant = new Date("2026-07-17T20:03:00.000Z");
    expect(timeInTimezone(instant, "America/Chicago")).toBe("15:03");
    expect(canonicalTimestampInTimezone(instant, "America/Chicago"))
      .toBe("2026-07-17T15:03:00.000-05:00");
  });

  it("handles daylight-saving boundaries explicitly", () => {
    expect(localDateTimeToCanonical("2026-03-08", "01:30", "America/Chicago"))
      .toContain("-06:00");
    expect(localDateTimeToCanonical("2026-03-08", "03:30", "America/Chicago"))
      .toContain("-05:00");
    expect(() => localDateTimeToCanonical("2026-03-08", "02:30", "America/Chicago"))
      .toThrow(/does not exist/);
    expect(localDateTimeToCanonical("2026-11-01", "01:30", "America/Chicago"))
      .toContain("-05:00");
  });
});
