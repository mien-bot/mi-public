import { describe, expect, it } from "vitest";
import {
  buildProjectMap,
  normalizeProjectStatus,
  renderProjectMapMarkdown,
  slugifyProjectName,
  type NotionPage,
} from "./projectMap";

function page(
  id: string,
  name: string,
  properties: NotionPage["properties"] = {},
): NotionPage {
  return {
    id,
    url: `https://notion.so/${id}`,
    created_time: "2026-01-01T00:00:00.000Z",
    last_edited_time: "2026-07-25T00:00:00.000Z",
    properties: {
      Name: { type: "title", title: [{ plain_text: name }] },
      ...properties,
    },
  };
}

describe("Notion project mapping", () => {
  it("normalizes known project statuses and preserves unknown values", () => {
    expect(normalizeProjectStatus("In Progress")).toBe("in-progress");
    expect(normalizeProjectStatus("Complete")).toBe("complete");
    expect(normalizeProjectStatus(undefined)).toBe("unknown");
    expect(normalizeProjectStatus("Waiting")).toBe("unknown");
  });

  it("creates stable URL-safe slugs", () => {
    expect(slugifyProjectName("25_0915 — SampleResidence", "abc")).toBe(
      "25-0915-sampleresidence",
    );
  });

  it("joins schedule records and surfaces data-quality gaps", () => {
    const project = page("project-1", "Test Project", {
      Status: { type: "status", status: { name: "In Progress" } },
      Team: {
        type: "people",
        people: [
          { id: "1", name: "Example Colleague" },
          { id: "2", name: "Example Colleague" },
        ],
      },
      "Total Hours": { type: "rollup", rollup: { type: "number", number: 0 } },
    });
    const schedule = page("schedule-1", "Client Meeting", {
      Projects: { type: "relation", relation: [{ id: "project-1" }] },
      Date: { type: "date", date: { start: "2026-07-20" } },
      Type: { type: "multi_select", multi_select: [{ name: "Meeting" }] },
      "Hours Total (M+A)": {
        type: "formula",
        formula: { type: "number", number: 2.5 },
      },
    });

    const map = buildProjectMap({
      generatedAt: "2026-07-25T00:00:00.000Z",
      projectSource: { id: "projects", title: "Studio Projects", url: "https://notion.so/p" },
      scheduleSource: { id: "schedule", title: "STUDIO Schedule", url: "https://notion.so/s" },
      projectPages: [project],
      schedulePages: [schedule],
    });

    expect(map.projects[0].team).toEqual(["Example Colleague"]);
    expect(map.projects[0].schedule.item_count).toBe(1);
    expect(map.projects[0].schedule.calculated_hours).toBe(2.5);
    expect(map.projects[0].data_quality).toContain("activity-with-zero-rollup-hours");
    expect(map.summary.linked_schedule_items).toBe(1);
    expect(renderProjectMapMarkdown(map)).toContain("Test Project");
  });
});
