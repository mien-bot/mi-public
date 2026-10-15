import { describe, expect, it } from "vitest";
import { formatListDate, formatListValueLabel } from "./AdvancedListUI";

describe("advanced list display helpers", () => {
  it("turns stored enum values into readable labels", () => {
    expect(formatListValueLabel("proposal-sent")).toBe("Proposal Sent");
    expect(formatListValueLabel("in-review")).toBe("In Review");
    expect(formatListValueLabel("active")).toBe("Active");
  });

  it("keeps missing and malformed dates explicit", () => {
    expect(formatListDate(null)).toBe("Not recorded");
    expect(formatListDate("not-a-date")).toBe("not-a-date");
  });

  it("formats a date-only value without shifting the calendar day", () => {
    const formatted = formatListDate("2026-07-28");
    expect(formatted).toContain("28");
    expect(formatted).toContain("2026");
  });
});
