import { describe, expect, it } from "vitest";
import type { ScheduleEntry } from "@/lib/notion/projectMap";
import { paginateScheduleEntries } from "./NotionScheduleActivity";

function entries(count: number): ScheduleEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    notion_page_id: `page-${index + 1}`,
    notion_url: `https://www.notion.so/page-${index + 1}`,
    name: `Entry ${index + 1}`,
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    do_date: null,
    types: [],
    hours: 0,
    attendees: [],
    project_page_ids: [],
  }));
}

describe("Notion schedule activity pagination", () => {
  it("defaults cleanly to the newest ten entries", () => {
    const result = paginateScheduleEntries(entries(23), 1, 10);
    expect(result.entries.map((entry) => entry.name)).toEqual([
      "Entry 23", "Entry 22", "Entry 21", "Entry 20", "Entry 19",
      "Entry 18", "Entry 17", "Entry 16", "Entry 15", "Entry 14",
    ]);
    expect(result).toMatchObject({ page: 1, pageCount: 3, from: 1, to: 10, total: 23 });
  });

  it("clamps an invalid page and reports the final range", () => {
    const result = paginateScheduleEntries(entries(23), 99, 10);
    expect(result.entries).toHaveLength(3);
    expect(result).toMatchObject({ page: 3, pageCount: 3, from: 21, to: 23 });
  });
});
