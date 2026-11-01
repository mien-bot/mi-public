import { describe, expect, it } from "vitest";
import { milestoneTrail, scopeExcerpt } from "./projectSnapshot";
import type { Milestone } from "./schema";

describe("project snapshot", () => {
  it("excerpts without rewriting facts or splitting Unicode characters", () => {
    expect(scopeExcerpt("  Keep\n this scope. ")).toEqual({ text: "Keep this scope.", shortened: false });
    expect(scopeExcerpt("", 10)).toEqual({ text: "", shortened: false });
    expect(scopeExcerpt("😀".repeat(12), 10)).toEqual({ text: "😀".repeat(10) + "…", shortened: true });
    expect(scopeExcerpt("Design the lobby and courtyard", 18).text).toBe("Design the lobby…");
  });
  it("excludes archived milestones and orders unfinished work without mutating records", () => {
    const item = (id: string, date: string, extra = {}): Milestone => ({ id, name: id, planned_date: date, actual_date: null, notion_event_id: null, ...extra });
    const records = [item("later", "2027-01-01"), item("done", "2025-01-01", { actual_date: "2025-01-02" }), item("archived", "2024-01-01", { archived_at: "2025-01-01T00:00:00Z" }), item("overdue", "2024-02-01")];
    const before = structuredClone(records);
    expect(milestoneTrail(records)).toMatchObject({ total: 3, completed: 1, remaining: 2 });
    expect(milestoneTrail(records).next.map(item => item.id)).toEqual(["overdue", "later"]);
    expect(records).toEqual(before);
    expect(milestoneTrail([])).toEqual({ total: 0, completed: 0, remaining: 0, next: [] });
  });
});
