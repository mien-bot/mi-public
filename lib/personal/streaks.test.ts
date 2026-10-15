import { describe, expect, it } from "vitest";
import { computeJournalStreaks, dayKey, streakMilestone } from "./streaks";
import { personalRecordSchema, type PersonalRecord } from "./schema";

const TZ = "America/Chicago";

function journal(id: string, createdAt: string): PersonalRecord {
  return personalRecordSchema.parse({
    id,
    kind: "journal",
    title: id,
    body: "",
    tags: [],
    mood: null,
    status: "inbox",
    schedule: null,
    share: { status: "local" },
    createdAt,
    updatedAt: createdAt,
  });
}

describe("dayKey", () => {
  it("groups a late-night entry into the local calendar day, not UTC", () => {
    // 11:30pm Central on Jan 15 is already Jan 16 in UTC.
    expect(dayKey("2026-01-16T05:30:00.000Z", TZ)).toBe("2026-01-15");
  });
});

describe("computeJournalStreaks", () => {
  it("counts a current streak through today when today is already logged", () => {
    const now = new Date("2026-07-31T18:00:00.000Z"); // afternoon Central on Jul 31
    const records = [
      journal("a", "2026-07-29T12:00:00.000Z"),
      journal("b", "2026-07-30T12:00:00.000Z"),
      journal("c", "2026-07-31T12:00:00.000Z"),
    ];
    const streaks = computeJournalStreaks(records, TZ, now);
    expect(streaks.loggedToday).toBe(true);
    expect(streaks.currentStreak).toBe(3);
    expect(streaks.longestStreak).toBe(3);
    expect(streaks.totalDaysJournaled).toBe(3);
    expect(streaks.totalEntries).toBe(3);
  });

  it("keeps the streak alive through yesterday when today has no entry yet", () => {
    const now = new Date("2026-07-31T13:00:00.000Z"); // early Central morning on Jul 31
    const records = [
      journal("a", "2026-07-29T12:00:00.000Z"),
      journal("b", "2026-07-30T12:00:00.000Z"),
    ];
    const streaks = computeJournalStreaks(records, TZ, now);
    expect(streaks.loggedToday).toBe(false);
    expect(streaks.currentStreak).toBe(2);
  });

  it("breaks the streak once a full day is missed, even though today isn't over yet", () => {
    // "now" is Jul 31 with no entry yet; yesterday (Jul 30) is also missing, so the streak
    // (last written Jul 28) is broken -- unlike the "keeps the streak alive" case above, where
    // yesterday itself still had an entry.
    const now = new Date("2026-07-31T13:00:00.000Z");
    const records = [
      journal("a", "2026-07-25T12:00:00.000Z"),
      journal("b", "2026-07-28T12:00:00.000Z"),
    ];
    const streaks = computeJournalStreaks(records, TZ, now);
    expect(streaks.currentStreak).toBe(0);
    expect(streaks.longestStreak).toBe(1);
  });

  it("counts multiple entries on the same day as one streak day", () => {
    const now = new Date("2026-07-31T18:00:00.000Z");
    const records = [
      journal("a", "2026-07-31T11:00:00.000Z"),
      journal("b", "2026-07-31T18:00:00.000Z"),
    ];
    const streaks = computeJournalStreaks(records, TZ, now);
    expect(streaks.totalDaysJournaled).toBe(1);
    expect(streaks.totalEntries).toBe(2);
    expect(streaks.currentStreak).toBe(1);
  });

  it("finds the longest historical streak even when the current streak is broken", () => {
    const now = new Date("2026-07-31T18:00:00.000Z");
    const records = [
      journal("a", "2026-06-01T12:00:00.000Z"),
      journal("b", "2026-06-02T12:00:00.000Z"),
      journal("c", "2026-06-03T12:00:00.000Z"),
      journal("d", "2026-06-04T12:00:00.000Z"),
      journal("e", "2026-07-10T12:00:00.000Z"),
    ];
    const streaks = computeJournalStreaks(records, TZ, now);
    expect(streaks.longestStreak).toBe(4);
    expect(streaks.currentStreak).toBe(0);
  });

  it("ignores non-journal records", () => {
    const now = new Date("2026-07-31T18:00:00.000Z");
    const thought = personalRecordSchema.parse({
      id: "t", kind: "thought", title: "t", body: "", tags: [], mood: null, status: "inbox",
      schedule: null, share: { status: "local" },
      createdAt: "2026-07-31T12:00:00.000Z", updatedAt: "2026-07-31T12:00:00.000Z",
    });
    const streaks = computeJournalStreaks([thought], TZ, now);
    expect(streaks.currentStreak).toBe(0);
    expect(streaks.totalEntries).toBe(0);
  });
});

describe("streakMilestone", () => {
  it("flags round-number streak milestones", () => {
    expect(streakMilestone(7)).toBe(7);
    expect(streakMilestone(30)).toBe(30);
    expect(streakMilestone(8)).toBeNull();
  });
});
