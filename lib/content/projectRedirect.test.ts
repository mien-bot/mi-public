import { describe, expect, it } from "vitest";
import { isCurrentProject, resolveCurrentProjectSlug } from "./projectRedirect";

describe("project replacement links", () => {
  const links: Record<string, string | undefined> = { old: "middle", middle: "current", loopA: "loopB", loopB: "loopA", broken: "gone" };
  const known = new Set(["old", "middle", "current", "loopA", "loopB", "broken"]);
  const next = (slug: string) => {
    if (!known.has(slug)) return null;
    const target = links[slug];
    return target && known.has(target) ? target : null;
  };

  it("leaves a replaced record out of lists", () => {
    expect(isCurrentProject({ meta: { terminal_project_slug: "current" } })).toBe(false);
    expect(isCurrentProject({ meta: { terminal_project_slug: null } })).toBe(true);
    expect(isCurrentProject({ meta: {} })).toBe(true);
  });

  it("follows confirmed links, and stays put on a cycle or a missing target", () => {
    expect(resolveCurrentProjectSlug("old", next)).toBe("current");
    expect(resolveCurrentProjectSlug("current", next)).toBe("current");
    expect(resolveCurrentProjectSlug("loopA", next)).toBe("loopA");
    expect(resolveCurrentProjectSlug("broken", next)).toBe("broken");
  });
});
