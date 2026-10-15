import { describe, expect, it, vi } from "vitest";
import {
  buildPersonalScheduleProperties,
  buildScheduleProperties,
  buildScheduleUpdateProperties,
  getScheduleEntry,
  queryFirmScheduleWindow,
  queryScheduleEntriesForProject,
  updateScheduleEntryDate,
} from "./schedule";
import { notionFetch } from "./client";

vi.mock("./client", () => ({ notionFetch: vi.fn() }));
const mockedNotionFetch = vi.mocked(notionFetch);

describe("STUDIO Schedule relation properties", () => {
  it("shares only reviewed public fields for a personal plan", () => {
    const properties = buildPersonalScheduleProperties({
      name: "Focus block",
      date: "2026-08-05",
      type: "Work Session",
      startTime: "2026-08-05T15:00:00.000Z",
    });
    expect(properties).toEqual({
      Name: { title: [{ text: { content: "Focus block" } }] },
      Date: { date: { start: "2026-08-05T15:00:00.000Z", end: null } },
      Type: { multi_select: [{ name: "Work Session" }] },
    });
    expect(properties).not.toHaveProperty("Start Time");
    expect(properties).not.toHaveProperty("Projects");
    expect(properties).not.toHaveProperty("Notes");
    expect(JSON.stringify(properties)).not.toContain("mood");
  });

  it("always includes the exact project page relation", () => {
    expect(buildScheduleProperties({
      projectPageId: "exact-project-page-id",
      name: "Client meeting",
      date: "2026-08-10",
      type: "Meeting",
      startTime: "2026-08-10T10:00:00.000-05:00",
      endTime: "2026-08-10T11:00:00.000-05:00",
    })).toMatchObject({
      Projects: { relation: [{ id: "exact-project-page-id" }] },
      Date: { date: { start: "2026-08-10T10:00:00.000-05:00", end: "2026-08-10T11:00:00.000-05:00" } },
    });
  });

  it("adds confirmed work-session hours and exact Notion people ids", () => {
    expect(buildScheduleProperties({
      projectPageId: "exact-project-page-id",
      name: "Drawing coordination",
      date: "2026-07-26",
      type: "Work Session",
      hours: 2.5,
      attendeeIds: ["person-alex", "person-taylor"],
    })).toMatchObject({
      Type: { multi_select: [{ name: "Work Session" }] },
      Projects: { relation: [{ id: "exact-project-page-id" }] },
      "Hours Manual": { number: 2.5 },
      Attendance: { people: [{ id: "person-alex" }, { id: "person-taylor" }] },
    });
  });

  it("omits optional time-entry properties when they were not confirmed", () => {
    const properties = buildScheduleProperties({ projectPageId: "project", name: "Deadline", date: "2026-08-01", type: "Deadline" });
    expect(properties).not.toHaveProperty("Hours Manual");
    expect(properties).not.toHaveProperty("Attendance");
    expect(properties).not.toHaveProperty("Status");
    expect(properties).not.toHaveProperty("Completed Date");
  });

  it("sets and clears the native Notion milestone completion properties explicitly", () => {
    expect(buildScheduleProperties({
      projectPageId: "project",
      name: "Deadline",
      date: "2026-08-01",
      type: "Deadline",
      status: "Done",
      completedDate: "2026-07-26",
    })).toMatchObject({
      Status: { status: { name: "Done" } },
      "Completed Date": { date: { start: "2026-07-26" } },
    });

    expect(buildScheduleProperties({
      projectPageId: "project",
      name: "Deadline",
      date: "2026-08-01",
      type: "Deadline",
      status: "In progress",
      completedDate: null,
    })).toMatchObject({
      Status: { status: { name: "In progress" } },
      "Completed Date": { date: null },
    });

    expect(buildScheduleUpdateProperties({
      projectPageId: "exact-project-page-id",
      date: "2026-08-01",
      status: "Done",
      completedDate: "2026-07-26",
    })).toEqual({
      Date: { date: { start: "2026-08-01" } },
      Projects: { relation: [{ id: "exact-project-page-id" }] },
      Status: { status: { name: "Done" } },
      "Completed Date": { date: { start: "2026-07-26" } },
    });

    expect(buildScheduleUpdateProperties({ date: "2026-08-12" })).toEqual({
      Date: { date: { start: "2026-08-12" } },
    });
  });
});

describe("getScheduleEntry", () => {
  it("reads current dates, times, status, and edit version for conflict checks", async () => {
    mockedNotionFetch.mockReset();
    mockedNotionFetch.mockResolvedValueOnce({
      id: "abc12345-abc1-2345-abc1-2345abc12345",
      url: "https://notion.so/event",
      last_edited_time: "2026-08-05T12:00:00.000Z",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Client meeting" }] },
        Date: { type: "date", date: { start: "2026-08-06T19:00:00-05:00", end: "2026-08-06T20:00:00-05:00" } },
        "Start Time": { type: "date", date: { start: "2026-08-06T13:33:00-05:00", end: null } },
        "End Time": { type: "date", date: null },
        Status: { type: "status", status: { name: "In progress" } },
      },
    });

    await expect(getScheduleEntry("abc12345abc12345abc12345abc12345")).resolves.toMatchObject({
      date: "2026-08-06T19:00:00-05:00",
      dateEnd: "2026-08-06T20:00:00-05:00",
      startTime: "2026-08-06T13:33:00-05:00",
      endTime: null,
      status: "In progress",
      lastEditedTime: "2026-08-05T12:00:00.000Z",
    });
  });
});

describe("updateScheduleEntryDate", () => {
  it("sends the complete calendar Date range without touching work-session fields", async () => {
    mockedNotionFetch.mockReset();
    mockedNotionFetch.mockResolvedValueOnce({});
    await updateScheduleEntryDate({
      eventPageId: "abc12345abc12345abc12345abc12345",
      date: "2026-08-11T13:00:00-05:00",
      dateEnd: "2026-08-11T14:30:00-05:00",
    });
    const body = JSON.parse((mockedNotionFetch.mock.calls[0][1]?.body as string) ?? "{}");
    expect(body.properties).toEqual({
      Date: { date: { start: "2026-08-11T13:00:00-05:00", end: "2026-08-11T14:30:00-05:00" } },
    });
  });
});

describe("queryFirmScheduleWindow", () => {
  it("sends a real Date filter, paginates, decodes Attendance, and includes entries with no Projects relation", async () => {
    mockedNotionFetch.mockReset();
    mockedNotionFetch
      // getStudioScheduleDatabaseId's /search call
      .mockResolvedValueOnce({
        results: [{ object: "database", id: "studio-schedule-db", title: [{ plain_text: "STUDIO Schedule" }] }],
      })
      // first page
      .mockResolvedValueOnce({
        results: [
          {
            id: "page-1",
            url: "https://notion.so/page-1",
            properties: {
              Name: { type: "title", title: [{ plain_text: "PTO" }] },
              Date: { type: "date", date: { start: "2026-08-05", end: null } },
              Attendance: { type: "people", people: [{ id: "person-alex", name: "Example User" }, { id: "person-x" }] },
            },
          },
        ],
        has_more: true,
        next_cursor: "cursor-2",
      })
      // second page
      .mockResolvedValueOnce({
        results: [
          {
            id: "page-2",
            url: "https://notion.so/page-2",
            properties: {
              Name: { type: "title", title: [{ plain_text: "Client Meeting" }] },
              Date: { type: "date", date: { start: "2026-08-06", end: null } },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });

    const entries = await queryFirmScheduleWindow({ from: "2026-08-01", to: "2026-08-31" });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "page-1",
      name: "PTO",
      date: "2026-08-05",
      attendees: [{ id: "person-alex", name: "Example User" }, { id: "person-x", name: null }],
    });
    expect(entries[1]).toMatchObject({ id: "page-2", name: "Client Meeting", attendees: [] });

    const queryCall = mockedNotionFetch.mock.calls[1];
    expect(queryCall[0]).toBe("/databases/studio-schedule-db/query");
    const body = JSON.parse((queryCall[1]?.body as string) ?? "{}");
    expect(body.filter).toEqual({
      and: [
        { property: "Date", date: { on_or_after: "2026-08-01" } },
        { property: "Date", date: { on_or_before: "2026-08-31" } },
      ],
    });
  });
});

describe("queryScheduleEntriesForProject", () => {
  it("uses the confirmed Projects relation as a server-side filter", async () => {
    mockedNotionFetch.mockReset();
    mockedNotionFetch.mockResolvedValueOnce({
      results: [{
        id: "page-1",
        properties: { Name: { type: "title", title: [{ plain_text: "Deadline" }] } },
      }],
      has_more: false,
      next_cursor: null,
    });

    await expect(queryScheduleEntriesForProject("exact-project-page-id")).resolves.toHaveLength(1);

    const body = JSON.parse((mockedNotionFetch.mock.calls[0][1]?.body as string) ?? "{}");
    expect(body.filter).toEqual({
      property: "Projects",
      relation: { contains: "exact-project-page-id" },
    });
  });
});
