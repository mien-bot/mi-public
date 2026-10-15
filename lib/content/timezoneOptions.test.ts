import { describe, expect, it, vi } from "vitest";
import {
  canonicalizeIanaTimezone,
  DETERMINISTIC_TIMEZONE_OPTIONS,
  getTimezoneOptions,
  includeTimezoneOption,
  timezoneOffsetLabel,
} from "./timezoneOptions";

describe("timezone options", () => {
  it("always includes the required canonical IANA zones", () => {
    const ids = DETERMINISTIC_TIMEZONE_OPTIONS.map((option) => option.id);
    expect(ids).toEqual(expect.arrayContaining([
      "America/Chicago",
      "America/New_York",
      "Asia/Taipei",
      "UTC",
    ]));
  });

  it("uses the runtime IANA catalog when available and keeps deterministic ordering", () => {
    const supportedValuesOf = vi.fn(() => [
      "Pacific/Auckland",
      "America/Chicago",
      "Europe/London",
      "America/Chicago",
    ]);
    const first = getTimezoneOptions(supportedValuesOf);
    const second = getTimezoneOptions(supportedValuesOf);
    expect(supportedValuesOf).toHaveBeenCalledWith("timeZone");
    expect(first).toEqual(second);
    expect(first.map((option) => option.id)).toEqual(
      [...first.map((option) => option.id)].sort((left, right) => left.localeCompare(right, "en")),
    );
    expect(first.map((option) => option.id)).toContain("Pacific/Auckland");
  });

  it("falls back deterministically if supportedValuesOf is missing or throws", () => {
    const fallback = getTimezoneOptions();
    const throwing = getTimezoneOptions(() => { throw new Error("unsupported"); });
    expect(throwing).toEqual(fallback);
    expect(fallback.length).toBeGreaterThan(80);
    expect(fallback.map((option) => option.id)).toEqual(expect.arrayContaining([
      "Africa/Cairo",
      "Asia/Taipei",
      "Europe/London",
      "Pacific/Auckland",
    ]));
  });

  it("shows deterministic standard/daylight offsets without replacing IANA IDs", () => {
    expect(timezoneOffsetLabel("America/Chicago")).toBe("UTC-06:00 / UTC-05:00");
    expect(timezoneOffsetLabel("Asia/Taipei")).toBe("UTC+08:00");
    expect(DETERMINISTIC_TIMEZONE_OPTIONS.find((option) => option.id === "America/New_York")?.label)
      .toContain("America/New_York (UTC-05:00 / UTC-04:00)");
  });

  it("canonicalizes valid preferences and preserves an existing valid choice", () => {
    expect(canonicalizeIanaTimezone("America/Chicago")).toBe("America/Chicago");
    expect(canonicalizeIanaTimezone("Not/A_Zone")).toBeNull();
    const options = includeTimezoneOption(
      getTimezoneOptions(() => ["America/Chicago"]),
      "Pacific/Auckland",
    );
    expect(options.some((option) => option.id === "Pacific/Auckland")).toBe(true);
  });
});
