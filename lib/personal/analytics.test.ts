import { describe, expect, it } from "vitest";
import { buildPersonalAnalytics } from "./analytics";
import type { PersonalDatabase } from "./schema";

describe("personal analytics", () => {
  it("counts records, schedules, conversations, tags, and monthly activity", () => {
    const database = {
      schemaVersion: 1,
      conversation: [],
      updatedAt: "2026-07-01T00:00:00.000Z",
      conversations: [{
        id: "chat", title: "Chat", messages: [
          { id: "m", role: "user", text: "Hi", createdAt: "2026-07-01T00:00:00.000Z" },
        ], sessionId: null, engine: "codex", model: "",
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      }],
      records: [{
        id: "one", kind: "plan", title: "Plan", body: "", tags: ["focus"], mood: null,
        status: "active",
        schedule: { name: "Plan", date: "2026-07-30", type: "Work Session", startTime: null, endTime: null },
        share: { status: "local" },
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      }],
    } satisfies PersonalDatabase;
    const result = buildPersonalAnalytics(database, new Date("2026-07-28T12:00:00Z"));
    expect(result).toMatchObject({ totalRecords: 1, scheduledPlans: 1, conversations: 1, chatMessages: 1 });
    expect(result.topTags).toEqual([{ tag: "focus", count: 1 }]);
    expect(result.monthlyActivity.at(-1)).toEqual({ month: "2026-07", count: 1 });
    expect(result.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Personal Mi", kind: "root" }),
      expect.objectContaining({ label: "Plan", kind: "plan" }),
      expect.objectContaining({ label: "Chat", kind: "chat" }),
      expect.objectContaining({ label: "#focus", kind: "tag" }),
    ]));
    expect(result.graph.links).toHaveLength(4);
  });
});
