import { describe, expect, it } from "vitest";
import { formatHoursAndMinutes } from "./duration";

describe("formatHoursAndMinutes", () => {
  it("rounds floating-point hour totals to the nearest minute", () => {
    expect(formatHoursAndMinutes(28.700000000000003)).toBe("28h 42m");
    expect(formatHoursAndMinutes(1.999)).toBe("2h");
    expect(formatHoursAndMinutes(0.5)).toBe("30m");
  });

  it("handles empty or invalid totals safely", () => {
    expect(formatHoursAndMinutes(0)).toBe("0m");
    expect(formatHoursAndMinutes(Number.NaN)).toBe("0m");
  });
});
