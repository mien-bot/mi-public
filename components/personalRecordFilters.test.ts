import { describe, expect, it } from "vitest";
import type { PersonalRecord } from "@/lib/personal/schema";
import {
  filterAndSortPersonalRecords,
  summarizePersonalRecords,
} from "./personalRecordFilters";

function record(
  id: string,
  overrides: Partial<PersonalRecord> = {},
): PersonalRecord {
  return {
    id,
    kind: "task",
    title: id,
    body: "",
    tags: [],
    mood: null,
    status: "active",
    schedule: null,
    share: { status: "local" },
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("personal record filters", () => {
  it("searches record content and combines kind and status filters", () => {
    const records = [
      record("call", { title: "Call engineer", tags: ["coordination"] }),
      record("journal", {
        kind: "journal",
        title: "Friday reflection",
        body: "Coordination went well.",
        status: "inbox",
      }),
    ];

    expect(filterAndSortPersonalRecords(records, {
      query: "coordination",
      kind: "task",
      status: "active",
    }).map((entry) => entry.id)).toEqual(["call"]);
  });

  it("filters upcoming, past, and unscheduled records against an explicit date", () => {
    const records = [
      record("past", { schedule: {
        name: "Past",
        date: "2026-07-20",
        type: "Work Session",
        startTime: null,
        endTime: null,
      } }),
      record("future", { schedule: {
        name: "Future",
        date: "2026-07-30",
        type: "Meeting",
        startTime: null,
        endTime: null,
      } }),
      record("none"),
    ];

    expect(filterAndSortPersonalRecords(records, {
      timing: "upcoming",
      today: "2026-07-28",
    }).map((entry) => entry.id)).toEqual(["future"]);
    expect(filterAndSortPersonalRecords(records, {
      timing: "past",
      today: "2026-07-28",
    }).map((entry) => entry.id)).toEqual(["past"]);
    expect(filterAndSortPersonalRecords(records, {
      timing: "unscheduled",
      today: "2026-07-28",
    }).map((entry) => entry.id)).toEqual(["none"]);
  });

  it("sorts scheduled records chronologically with unscheduled records last", () => {
    const records = [
      record("none", { updatedAt: "2026-08-01T12:00:00.000Z" }),
      record("later", { schedule: {
        name: "Later",
        date: "2026-08-10",
        type: "Deadline",
        startTime: null,
        endTime: null,
      } }),
      record("sooner", { schedule: {
        name: "Sooner",
        date: "2026-08-01",
        type: "Meeting",
        startTime: null,
        endTime: null,
      } }),
    ];

    expect(filterAndSortPersonalRecords(records, { sort: "scheduled" }).map(
      (entry) => entry.id,
    )).toEqual(["sooner", "later", "none"]);
  });

  it("summarizes active, scheduled, and shared records", () => {
    const records = [
      record("active"),
      record("scheduled", { schedule: {
        name: "Scheduled",
        date: "2026-08-01",
        type: "Meeting",
        startTime: null,
        endTime: null,
      } }),
      record("shared", {
        status: "done",
        share: {
          status: "shared",
          syncKey: "shared",
          notionPageId: "page",
          notionUrl: "https://notion.so/page",
          sharedAt: "2026-07-28T12:00:00.000Z",
        },
      }),
    ];

    expect(summarizePersonalRecords(records)).toEqual({
      total: 3,
      active: 2,
      scheduled: 1,
      shared: 1,
    });
  });
});
