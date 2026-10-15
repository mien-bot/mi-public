import { describe, expect, it } from "vitest";
import {
  applyOptimisticScheduleReschedule,
  buildDragDuplicateProposal,
  buildDragRescheduleProposal,
  canDragScheduleEntry,
  dateFromScheduleKey,
  moveScheduleAnchor,
  scheduleDateKey,
  scheduleVisibleDays,
} from "./scheduleCalendarModel";
import type { ScheduleSnapshotEntry } from "@/types/electron";

const entry: ScheduleSnapshotEntry = {
  notion_page_id: "abc12345abc12345abc12345abc12345",
  name: "Permit deadline",
  date: "2026-08-05",
  start_time: null,
  end_time: null,
  last_edited_time: null,
  type: ["Deadline"],
  status: "Not started",
  hours: null,
  attendees: [],
  project_page_ids: [],
};

describe("schedule calendar model", () => {
  it("builds stable month, week, work-week, and day ranges", () => {
    const anchor = new Date(2026, 7, 5);
    expect(scheduleVisibleDays(anchor, "month")).toHaveLength(42);
    expect(scheduleDateKey(scheduleVisibleDays(anchor, "week")[0])).toBe("2026-08-02");
    expect(scheduleVisibleDays(anchor, "work-week").map(scheduleDateKey)).toEqual([
      "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07",
    ]);
    expect(scheduleVisibleDays(anchor, "day").map(scheduleDateKey)).toEqual(["2026-08-05"]);
  });

  it("navigates by the unit represented by each view", () => {
    const anchor = new Date(2026, 7, 5);
    expect(scheduleDateKey(moveScheduleAnchor(anchor, "day", 1))).toBe("2026-08-06");
    expect(scheduleDateKey(moveScheduleAnchor(anchor, "week", -1))).toBe("2026-07-29");
    expect(scheduleDateKey(moveScheduleAnchor(anchor, "month", 1))).toBe("2026-09-01");
  });

  it("parses date-only values in local calendar time and rejects impossible dates", () => {
    expect(scheduleDateKey(dateFromScheduleKey("2026-08-05"))).toBe("2026-08-05");
    expect(() => dateFromScheduleKey("2026-02-30")).toThrow(/real calendar date/);
  });

  it("creates a validated drag proposal for untimed entries", () => {
    expect(canDragScheduleEntry(entry)).toBe(true);
    expect(buildDragRescheduleProposal(entry, "2026-08-07", "request-1")).toMatchObject({
      id: "calendar-move-request-1",
      kind: "schedule-reschedule",
      data: { currentDate: "2026-08-05", newDate: "2026-08-07" },
    });
    expect(buildDragRescheduleProposal(entry, "2026-08-05", "request-2")).toBeNull();
  });

  it("moves a timed event atomically while preserving its duration across daylight saving", () => {
    const timed = {
      ...entry,
      date: "2026-10-30T09:00:00-05:00",
      date_end: "2026-10-30T10:30:00-05:00",
      start_time: "2026-10-30T13:33:00-05:00",
      end_time: null,
    };
    expect(canDragScheduleEntry(timed)).toBe(true);
    expect(buildDragRescheduleProposal(timed, "2026-11-02", "request-3", {
      timezone: "America/Chicago",
    })).toMatchObject({
      data: {
        currentDate: "2026-10-30",
        newDate: "2026-11-02",
        newStartTime: "2026-11-02T09:00:00.000-06:00",
        newEndTime: "2026-11-02T10:30:00.000-06:00",
      },
    });
  });

  it("moves a timed event within a day and preserves its duration", () => {
    const timed = {
      ...entry,
      date: "2026-08-05T09:00:00-05:00",
      date_end: "2026-08-05T10:30:00-05:00",
    };
    expect(buildDragRescheduleProposal(timed, "2026-08-05", "request-4", {
      targetMinutes: 13 * 60 + 15,
      timezone: "America/Chicago",
    })).toMatchObject({
      data: {
        newStartTime: "2026-08-05T13:15:00.000-05:00",
        newEndTime: "2026-08-05T14:45:00.000-05:00",
      },
    });
  });

  it("resizes a timed event only when the new end is after its start", () => {
    const timed = {
      ...entry,
      date: "2026-08-05T09:00:00-05:00",
      date_end: "2026-08-05T10:00:00-05:00",
    };
    expect(buildDragRescheduleProposal(timed, "2026-08-05", "request-5", {
      mode: "resize",
      targetMinutes: 11 * 60 + 30,
      timezone: "America/Chicago",
    })).toMatchObject({ data: { newEndTime: "2026-08-05T11:30:00.000-05:00" } });
    expect(buildDragRescheduleProposal(timed, "2026-08-06", "request-overnight", {
      mode: "resize",
      targetMinutes: 8 * 60,
      timezone: "America/Chicago",
    })).toMatchObject({
      data: { newDate: "2026-08-05", newEndTime: "2026-08-06T08:00:00.000-05:00" },
    });
    expect(() => buildDragRescheduleProposal(timed, "2026-08-05", "request-6", {
      mode: "resize",
      targetMinutes: 8 * 60,
      timezone: "America/Chicago",
    })).toThrow(/after the event start/);
  });

  it("moves an entry optimistically without touching its work-session fields", () => {
    const proposal = buildDragRescheduleProposal(entry, "2026-08-07", "request-optimistic");
    if (!proposal || proposal.kind !== "schedule-reschedule") throw new Error("Expected a reschedule proposal.");
    const snapshot = {
      schema_version: 3,
      generated_at: "2026-08-05T12:00:00.000Z",
      window: { from: "2026-08-01", to: "2026-08-31" },
      entries: [{ ...entry, start_time: "2026-08-05T13:33:00-05:00" }],
    };

    const optimistic = applyOptimisticScheduleReschedule(snapshot, proposal);

    expect(optimistic?.entries[0]).toMatchObject({
      date: "2026-08-07",
      date_end: null,
      start_time: "2026-08-05T13:33:00-05:00",
    });
    expect(snapshot.entries[0].date).toBe("2026-08-05");
  });

  it("builds a separate create request for Ctrl-drag duplication, including same-day copies", () => {
    expect(buildDragDuplicateProposal(entry, "2026-08-05", "copy-1")).toMatchObject({
      id: "calendar-copy-copy-1",
      kind: "schedule-duplicate",
      data: { eventPageId: entry.notion_page_id, currentDate: "2026-08-05", newDate: "2026-08-05" },
    });
  });
});
