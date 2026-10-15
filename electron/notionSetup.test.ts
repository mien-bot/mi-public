import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { probeNotionSources, refreshProjectSnapshot, refreshScheduleSnapshot } = require("./notionSetup");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function response(body: unknown, status = 200) {
  return { ok: status < 400, status, statusText: status === 200 ? "OK" : "Forbidden", json: async () => body };
}

describe("Notion setup checks", () => {
  it("tests both sources without any mutation request", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => response({
      id: "database-id",
      properties: url.includes("1111")
        ? {
            Name: { type: "title" },
            Status: { type: "status" },
            Client: { type: "rich_text" },
            Location: { type: "rich_text" },
            "Project Type": { type: "multi_select" },
            Scope: { type: "multi_select" },
            Team: { type: "people" },
            "Total Hours": { type: "rollup" },
          }
        : {
            Name: { type: "title" },
            Date: { type: "date" },
            Type: { type: "multi_select" },
            Projects: { type: "relation" },
            Status: { type: "status" },
            Attendance: { type: "people" },
          },
    }));
    const health = await probeNotionSources({
      token: "fake-token",
      projectsDataSourceId: "collection://11111111-1111-1111-1111-111111111111",
      scheduleDataSourceId: "collection://22222222-2222-2222-2222-222222222222",
      fetchImpl: fetchMock,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === undefined)).toBe(true);
    expect(health.mutationCount).toBe(0);
    expect(health.capabilities.update).toBe("configured-not-write-tested");
    expect(health.capabilities.insert).toBe("configured-not-write-tested");
    expect(health.projects.schema.status).toBe("compatible");
    expect(health.schedule.schema.status).toBe("compatible");
  });

  it("makes writes unavailable when a configured source has schema drift", async () => {
    const fetchMock = vi.fn(async () => response({
      id: "database-id",
      properties: { Name: { type: "rich_text" } },
    }));
    const health = await probeNotionSources({
      token: "fake-token",
      projectsDataSourceId: "collection://11111111-1111-1111-1111-111111111111",
      scheduleDataSourceId: "collection://22222222-2222-2222-2222-222222222222",
      fetchImpl: fetchMock,
    });
    expect(health.capabilities.read).toBe("available");
    expect(health.capabilities.update).toBe("unavailable");
    expect(health.projects.schema.status).toBe("incompatible");
    expect(health.projects.schema.missing).toContain("Status");
  });

  it("writes a read-only project query result only to the local cache", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-notion-cache-"));
    roots.push(root);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => response(
      init?.method === "POST"
        ? {
            results: [{
              id: "page-id",
              url: "https://www.notion.so/page-id",
              created_time: "2026-01-01T00:00:00.000Z",
              last_edited_time: "2026-07-20T00:00:00.000Z",
              properties: {
                Name: { type: "title", title: [{ plain_text: "Demo" }] },
                Status: { type: "status", status: { name: "In Progress" } },
                Client: { type: "rich_text", rich_text: [{ plain_text: "Studio" }] },
                Location: { type: "rich_text", rich_text: [{ plain_text: "Chicago" }] },
                "Project Type": { type: "multi_select", multi_select: [{ name: "Commercial" }] },
                Scope: { type: "multi_select", multi_select: [{ name: "Architecture" }] },
                Team: { type: "people", people: [{ id: "person-alex", name: "Example User" }] },
                "Total Hours": { type: "rollup", rollup: { type: "number", number: 12.5 } },
                Alex: { type: "formula", formula: { type: "number", number: 8 } },
                "Taylor ": { type: "number", number: 4.5 },
              },
            }],
            has_more: false,
            next_cursor: null,
          }
        : { id: "11111111111111111111111111111111", properties: {} },
    ));
    const result = await refreshProjectSnapshot({
      token: "fake-token",
      projectsDataSourceId: "collection://11111111-1111-1111-1111-111111111111",
      dataRoot: root,
      fetchImpl: fetchMock,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });
    expect(result.projectCount).toBe(1);
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[1][0]).toContain("/data_sources/");
    expect(fetchMock.mock.calls[1][0]).toContain("/query");
    const written = JSON.parse(fs.readFileSync(path.join(root, "notion", "project-map.json"), "utf8"));
    expect(written.projects[0]).toMatchObject({
      name: "Demo",
      status: "in-progress",
      client: "Studio",
      location: "Chicago",
      project_types: ["Commercial"],
      scope: ["Architecture"],
      team: ["Example User"],
      total_hours: 12.5,
      hours_by_person: { alex: 8, taylor: 4.5 },
      data_quality: [],
    });
    expect(written.summary).toMatchObject({
      by_status: { "in-progress": 1 },
      total_reported_hours: 12.5,
      projects_with_data_gaps: 0,
    });
  });

  it("writes a bounded, read-only firm-wide schedule window to its own cache file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-notion-cache-"));
    roots.push(root);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => response(
      init?.method === "POST"
        ? {
            results: [{
              id: "page-id",
              properties: {
                Name: { type: "title", title: [{ plain_text: "PTO" }] },
                Date: { type: "date", date: { start: "2026-08-05T13:00:00-05:00", end: "2026-08-05T14:30:00-05:00" } },
                "Start Time": { type: "date", date: { start: "2026-08-05T09:00:00-05:00" } },
                "End Time": { type: "date", date: { start: "2026-08-05T10:30:00-05:00" } },
                Type: { type: "multi_select", multi_select: [{ name: "Meeting" }] },
                Attendance: { type: "people", people: [{ id: "person-alex", name: "Example User" }] },
              },
              last_edited_time: "2026-08-01T10:00:00.000Z",
            }],
            has_more: false,
            next_cursor: null,
          }
        : { id: "22222222222222222222222222222222", properties: {} },
    ));
    const result = await refreshScheduleSnapshot({
      token: "fake-token",
      scheduleDataSourceId: "collection://22222222-2222-2222-2222-222222222222",
      dataRoot: root,
      fetchImpl: fetchMock,
      now: () => new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(result.entryCount).toBe(1);
    expect(result.window).toEqual({ from: "2026-07-02", to: "2026-11-29" });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(requestBody.filter).toEqual({
      and: [
        { property: "Date", date: { on_or_after: "2026-07-02" } },
        { property: "Date", date: { on_or_before: "2026-11-29" } },
      ],
    });

    const written = JSON.parse(fs.readFileSync(path.join(root, "notion", "schedule-snapshot.json"), "utf8"));
    expect(written.entries).toEqual([{
      notion_page_id: "page-id",
      name: "PTO",
      date: "2026-08-05T13:00:00-05:00",
      date_end: "2026-08-05T14:30:00-05:00",
      start_time: "2026-08-05T09:00:00-05:00",
      end_time: "2026-08-05T10:30:00-05:00",
      last_edited_time: "2026-08-01T10:00:00.000Z",
      type: ["Meeting"],
      status: null,
      hours: null,
      attendees: [{ id: "person-alex", name: "Example User" }],
      project_page_ids: [],
    }]);
    // Never touches the tracked project.yaml/schedule.yaml content model, same as refreshProjectSnapshot.
    expect(fs.existsSync(path.join(root, "projects"))).toBe(false);
  });
});
