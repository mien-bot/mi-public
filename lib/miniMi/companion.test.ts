import { describe, expect, it } from "vitest";
import { visibleMiActivities, validMiActivity, type MiActivity } from "./activity";
import { parseFocus } from "./focus";
import { milestoneSuggestions } from "./suggestions";

describe("Companion boundaries", () => {
  const privateEntry: MiActivity = { id: "private", scope: "personal", href: "/personal", label: "Private assistant", state: "running", updatedAt: 1 };
  const projectEntry: MiActivity = { ...privateEntry, id: "project", scope: "projects/demo", href: "/projects/demo", label: "Project" };
  it("keeps private activity out of shared surfaces and shared activity out of personal", () => {
    expect(visibleMiActivities([privateEntry, projectEntry], "/projects/demo")).toEqual([projectEntry]);
    expect(visibleMiActivities([privateEntry, projectEntry], "/personal")).toEqual([privateEntry]);
  });
  it("rejects external destinations and malformed cross-window activity", () => {
    expect(validMiActivity(projectEntry)).toBe(true);
    expect(validMiActivity({ ...projectEntry, href: "//outside.test" })).toBe(false);
    expect(validMiActivity({ ...projectEntry, href: "javascript:alert(1)" })).toBe(false);
    expect(validMiActivity({ ...projectEntry, updatedAt: Infinity })).toBe(false);
    expect(validMiActivity({ ...projectEntry, state: "made-up" })).toBe(false);
  });
  it("restores focus deadlines without inventing a new session after reload", () => {
    expect(parseFocus('{"phase":"focus","minutes":25,"endsAt":1234}')).toEqual({phase:"focus",minutes:25,endsAt:1234});
    for (const raw of [null,"{",'{"phase":"focus","minutes":0,"endsAt":1}','{"phase":"other","minutes":25,"endsAt":1}']) expect(parseFocus(raw)).toBeNull();
  });
  it("suggests only saved, incomplete milestones in the next seven days, ordered by date", () => {
    const milestone = { id: "a", name: "Review", actual_date: null, notion_event_id: null, planned_date: "2026-10-01" };
    const suggestions = milestoneSuggestions("demo", [
      { ...milestone, id: "past", planned_date: "2026-09-01" },
      { ...milestone, id: "done", actual_date: "2026-09-28" },
      { ...milestone, id: "far", planned_date: "2026-12-01" },
      milestone, { ...milestone, id: "today", planned_date: "2026-09-29" },
    ], "2026-09-29");
    expect(suggestions.map(s => s.id)).toEqual(["milestone:demo:today:2026-09-29", "milestone:demo:a:2026-10-01"]);
  });
});
