import { describe, expect, it } from "vitest";
import { deriveIdentity } from "./identity";

describe("deriveIdentity", () => {
  it("is stable across case and whitespace differences in sheet/file", () => {
    const a = deriveIdentity({ sheet: "A-101", revision: 2, file: "originals/A-101.pdf" });
    const b = deriveIdentity({ sheet: " a-101 ", revision: 2, file: "ORIGINALS/A-101.PDF" });
    expect(a).toBe(b);
  });

  it("normalizes backslashes the same as forward slashes", () => {
    const a = deriveIdentity({ sheet: "A-101", revision: 2, file: "originals/A-101.pdf" });
    const b = deriveIdentity({ sheet: "A-101", revision: 2, file: "originals\\A-101.pdf" });
    expect(a).toBe(b);
  });

  it("differs when revision differs", () => {
    const a = deriveIdentity({ sheet: "A-101", revision: 2, file: "originals/A-101.pdf" });
    const b = deriveIdentity({ sheet: "A-101", revision: 3, file: "originals/A-101.pdf" });
    expect(a).not.toBe(b);
  });

  it("differs when file differs", () => {
    const a = deriveIdentity({ sheet: "A-101", revision: 2, file: "originals/round-1.pdf" });
    const b = deriveIdentity({ sheet: "A-101", revision: 2, file: "originals/round-2.pdf" });
    expect(a).not.toBe(b);
  });

  it("differs when sheet differs", () => {
    const a = deriveIdentity({ sheet: "A-101", revision: 2, file: "originals/A-101.pdf" });
    const b = deriveIdentity({ sheet: "A-102", revision: 2, file: "originals/A-101.pdf" });
    expect(a).not.toBe(b);
  });
});
