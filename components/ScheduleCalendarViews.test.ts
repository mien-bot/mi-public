import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonthScheduleView, TimedScheduleView, scheduleEntryColor } from "./ScheduleCalendarViews";

describe("scheduleEntryColor", () => {
  it("keeps entries without a project relation neutral", () => {
    expect(scheduleEntryColor({ project_page_ids: [] })).toBe("var(--muted-foreground)");
  });

  it("uses the project relation rather than the event identity", () => {
    const first = scheduleEntryColor({ project_page_ids: ["project-alpha"] });
    const second = scheduleEntryColor({ project_page_ids: ["project-alpha"] });
    expect(second).toBe(first);
  });

  it("is stable when a multi-project relation arrives in a different order", () => {
    expect(scheduleEntryColor({ project_page_ids: ["project-beta", "project-alpha"] }))
      .toBe(scheduleEntryColor({ project_page_ids: ["project-alpha", "project-beta"] }));
  });
});

describe("calendar quick add", () => {
  const callbacks = {
    onOpen: () => undefined,
    onDragStart: () => undefined,
    onDragEnd: () => undefined,
    onCreate: () => undefined,
  };

  it("offers an add button on every visible month date", () => {
    const date = new Date(2026, 7, 5);
    const markup = renderToStaticMarkup(createElement(MonthScheduleView, {
      ...callbacks,
      days: [date],
      anchor: date,
      todayKey: "2026-08-05",
      entriesByDate: new Map(),
      onDrop: () => undefined,
      timezone: "America/Chicago",
    }));

    expect(markup).toContain('aria-label="Add event on 2026-08-05"');
  });

  it("offers the same date-specific add action in timed views", () => {
    const markup = renderToStaticMarkup(createElement(TimedScheduleView, {
      ...callbacks,
      view: "day",
      days: [new Date(2026, 7, 5)],
      todayKey: "2026-08-05",
      entriesByDate: new Map(),
      onDrop: () => undefined,
      timezone: "America/Chicago",
    }));

    expect(markup).toContain('aria-label="Add event on 2026-08-05"');
  });
});
