import { describe, expect, it } from "vitest";
import { projectAsks } from "./projectAsks";

const item = (id: string, name: string, planned_date: string, extra: object = {}) =>
  ({ id, name, planned_date, actual_date: null, notion_event_id: null, ...extra });
const today = "2026-11-01";

describe("projectAsks", () => {
  it("asks about missed milestones first, then past events, then unclear items", () => {
    const asks = projectAsks([
      item("meeting", "Client Meeting", "2026-10-01"),
      item("due", "Submit permit set", "2026-10-20"),
      item("unclear", "Lobby stuff", "2026-12-01"),
    ], today);
    expect(asks.map((ask) => ask.kind)).toEqual(["overdue", "past-event", "category"]);
  });

  it("does not ask about what it already knows, finished work, or archived items", () => {
    expect(projectAsks([
      item("typed", "Lobby stuff", "2026-12-01", { type: "Deadline" }),
      item("named", "GC Meeting", "2026-12-02"),
      item("worded", "Permit deadline", "2026-12-03"),
      item("done", "Old thing", "2026-10-01", { actual_date: "2026-10-01" }),
      item("gone", "Older thing", "2026-10-01", { archived_at: "2026-10-02T00:00:00.000Z" }),
    ], today)).toEqual([]);
  });

  it("asks again when a person moves a missed date and misses it too", () => {
    const [first] = projectAsks([item("due", "Submit set", "2026-10-20")], today);
    const [second] = projectAsks([item("due", "Submit set", "2026-10-25")], today);
    expect(first.id).not.toBe(second.id);
  });
});
