import { describe, expect, it } from "vitest";
import { projectGuideForPath } from "./ProjectPageGuide";

describe("project page guidance", () => {
  it("gives specific guidance for planning and delivery records", () => {
    expect(projectGuideForPath("/projects/example/schedule").title).toBe("Plan & Timeline");
    expect(projectGuideForPath("/projects/example/schedule").steps.join(" ")).toMatch(/Notion/i);
    expect(projectGuideForPath("/projects/example/qaqc").purpose).toMatch(/review/i);
  });

  it("falls back safely for a future project route", () => {
    const guide = projectGuideForPath("/projects/example/future-tool");
    expect(guide.title).toBe("Project workspace");
    expect(guide.steps.join(" ")).toMatch(/confirm/i);
  });
});
