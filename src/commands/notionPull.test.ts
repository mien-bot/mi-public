import { describe, expect, it } from "vitest";
import { mapWithConcurrency, parseNotionPullArgs } from "./notionPull";

describe("parseNotionPullArgs", () => {
  it("accepts a single project or --all", () => {
    expect(parseNotionPullArgs(["demo", "--apply"])).toEqual({
      all: false,
      apply: true,
      help: false,
      slug: "demo",
    });
    expect(parseNotionPullArgs(["--all"])).toMatchObject({ all: true, slug: null });
  });

  it("rejects ambiguous and unknown inputs", () => {
    expect(() => parseNotionPullArgs(["demo", "--all"])).toThrow("either");
    expect(() => parseNotionPullArgs(["demo", "--wat"])).toThrow("Unknown option");
    expect(() => parseNotionPullArgs(["one", "two"])).toThrow("one project slug");
  });
});

describe("mapWithConcurrency", () => {
  it("bounds concurrent work while processing every item", async () => {
    let active = 0;
    let maximum = 0;
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      seen.push(value);
      active--;
    });
    expect(maximum).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
