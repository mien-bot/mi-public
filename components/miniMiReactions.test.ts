import { describe, expect, it } from "vitest";
import { MINI_MI_REACTIONS, nextMiniMiReaction } from "./miniMiReactions";
import type { MiniMiActivity } from "@/lib/theme/useMiniMi";

describe("Mini Mi click reactions", () => {
  it("visits every playful reaction before repeating, including at the wraparound", () => {
    let previous: MiniMiActivity | null = null;
    const seen: MiniMiActivity[] = [];
    for (let i = 0; i < MINI_MI_REACTIONS.length * 2; i++) {
      const next = nextMiniMiReaction(previous);
      expect(next).not.toBe(previous);
      seen.push(next);
      previous = next;
    }
    expect(new Set(seen.slice(0, MINI_MI_REACTIONS.length)).size).toBe(MINI_MI_REACTIONS.length);
    expect(seen.slice(MINI_MI_REACTIONS.length)).toEqual(seen.slice(0, MINI_MI_REACTIONS.length));
    expect(seen).not.toContain("working");
    expect(seen).not.toContain("thinking");
  });
  it("starts a new playful cycle from an ambient or work pose", () => {
    expect(nextMiniMiReaction("idle")).toBe("dancing");
    expect(nextMiniMiReaction("working")).toBe("dancing");
  });
  it("cycles only favorites, allows one replay, and supports opting out completely", () => {
    expect(nextMiniMiReaction("happy", ["happy", "jumping"])).toBe("jumping");
    expect(nextMiniMiReaction("jumping", ["happy", "jumping"])).toBe("happy");
    expect(nextMiniMiReaction("happy", ["happy"])).toBe("happy");
    expect(nextMiniMiReaction("happy", [])).toBe("idle");
  });
});
