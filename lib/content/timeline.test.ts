import { describe, expect, it, vi } from "vitest";

vi.mock("./projects", () => ({
  getDrawingIndex: () => [],
  getMarkupIndex: () => [],
  getPermits: () => [],
  getProgressLog: () => [],
  getReviews: () => [],
  getSchedule: () => ({ milestones: [] }),
}));

vi.mock("./leads", () => ({
  getLeadsForProject: () => [
    {
      slug: "north-office-lead",
      lead: {
        name: "North Office",
        source: "referral",
        converted_date: "2026-07-01",
        converted_project_slug: "north-office",
      },
    },
  ],
}));

import { getProjectTimeline } from "./timeline";

describe("getProjectTimeline lead-conversion entries", () => {
  it("links to the specific converted lead, not the leads list", () => {
    const entries = getProjectTimeline("north-office");
    const conversion = entries.find((entry) => entry.type === "lead-conversion");
    expect(conversion?.href).toBe("/leads/north-office-lead");
  });
});
