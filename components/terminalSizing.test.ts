import { describe, expect, it } from "vitest";
import { shouldFitTerminal } from "./terminalSizing";

describe("stable terminal fitting", () => {
  it("ignores hidden and tiny layouts", () => {
    expect(shouldFitTerminal(false, { width: 900, height: 600 }, null)).toBe(false);
    expect(shouldFitTerminal(true, { width: 0, height: 0 }, null)).toBe(false);
    expect(shouldFitTerminal(true, { width: 120, height: 90 }, null)).toBe(false);
  });

  it("fits visible layouts only when their dimensions materially change", () => {
    const previous = { width: 900, height: 600 };
    expect(shouldFitTerminal(true, { width: 900, height: 600 }, previous)).toBe(false);
    expect(shouldFitTerminal(true, { width: 901, height: 601 }, previous)).toBe(false);
    expect(shouldFitTerminal(true, { width: 904, height: 600 }, previous)).toBe(true);
    expect(shouldFitTerminal(true, { width: 900, height: 600 }, previous, true)).toBe(true);
  });
});
