import { describe, expect, it, vi } from "vitest";

const {
  createPersonalCalendarEntry,
  listPersonalCalendars,
  personalCalendarProperties,
  validateCalendarSelection,
} = require("./personalNotionCalendar");

const sourceId = "1234567890abcdef1234567890abcdef";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("personal Notion calendar", () => {
  it("lists only exact accessible data sources and reports their compatible fields", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [
        { object: "page", id: "ignored" },
        {
          object: "data_source",
          id: sourceId,
          title: [{ plain_text: "Alex Schedule" }],
          properties: {
            Name: { type: "title" },
            When: { type: "date" },
            Notes: { type: "rich_text" },
          },
        },
      ],
      has_more: false,
      next_cursor: null,
    }));

    await expect(listPersonalCalendars({ token: "fake-token", fetchImpl })).resolves.toEqual([{
      id: sourceId,
      name: "Alex Schedule",
      titleProperties: ["Name"],
      dateProperties: ["When"],
      compatible: true,
    }]);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer fake-token");
  });

  it("accepts only a returned calendar and selected title/date properties", () => {
    const calendar = {
      id: sourceId,
      name: "Alex Schedule",
      titleProperties: ["Name"],
      dateProperties: ["When", "Due"],
      compatible: true,
    };
    expect(validateCalendarSelection(calendar, {
      dataSourceId: sourceId,
      titleProperty: "Name",
      dateProperty: "Due",
    })).toMatchObject({
      personalCalendarDataSourceId: sourceId,
      personalCalendarName: "Alex Schedule",
      personalCalendarDateProperty: "Due",
    });
    expect(() => validateCalendarSelection(calendar, {
      dataSourceId: sourceId,
      titleProperty: "Name",
      dateProperty: "Invented",
    })).toThrow(/date property/);
  });

  it("writes only reviewed schedule fields to the confirmed data source", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: "created-page",
      url: "https://www.notion.so/created-page",
    }));
    const settings = {
      personalCalendarDataSourceId: sourceId,
      personalCalendarTitleProperty: "Task",
      personalCalendarDateProperty: "When",
    };
    const input = {
      name: "Dentist",
      date: "2026-08-10",
      startTime: "2026-08-10T09:00:00-05:00",
      endTime: "2026-08-10T10:00:00-05:00",
      body: "must stay private",
    };

    expect(personalCalendarProperties(input, settings)).toEqual({
      Task: { title: [{ text: { content: "Dentist" } }] },
      When: { date: { start: "2026-08-10T09:00:00-05:00", end: "2026-08-10T10:00:00-05:00" } },
    });
    await expect(createPersonalCalendarEntry({ token: "fake-token", settings, input, fetchImpl }))
      .resolves.toEqual({ id: "created-page", url: "https://www.notion.so/created-page" });
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(request.parent).toEqual({ type: "data_source_id", data_source_id: sourceId });
    expect(JSON.stringify(request)).not.toContain("must stay private");
  });
});
