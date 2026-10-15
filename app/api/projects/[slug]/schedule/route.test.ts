import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  query: vi.fn(),
  write: vi.fn(),
  currentHash: vi.fn(() => "current-hash"),
  schedule: { milestones: [] as Array<{
    id: string;
    name: string;
    planned_date: string;
    actual_date: string | null;
    notion_event_id: string | null;
    sync_key: string | null;
  }> },
}));

vi.mock("@/lib/content", () => ({
  getProjectSlugs: () => ["demo"],
  getProject: () => ({ slug: "demo", meta: { notion_page_id: "exact-project-id" } }),
  getSchedule: () => mocks.schedule,
  writeProjectSchedule: mocks.write,
  schedulePath: () => "/fake/projects/demo/schedule/schedule.yaml",
}));

vi.mock("@/lib/content/atomicContentWrite", () => ({
  readCurrentHash: mocks.currentHash,
  ContentConflictError: class ContentConflictError extends Error {
    currentHash: string | null;
    constructor(filePath: string, expectedHash: string | null, currentHash: string | null) {
      super("conflict");
      this.currentHash = currentHash;
    }
  },
}));

vi.mock("@/src/adapters/notion/schedule", () => ({
  createProjectScheduleEntry: mocks.create,
  getScheduleEntry: mocks.get,
  updateProjectScheduleEntry: mocks.update,
  queryScheduleEntriesForProject: mocks.query,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { PATCH, POST } from "./route";

const context = { params: Promise.resolve({ slug: "demo" }) };

describe("schedule route confirmation contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.schedule.milestones = [{
      id: "milestone-1",
      name: "Permit set",
      planned_date: "2026-08-10",
      actual_date: null,
      notion_event_id: "event-1",
      sync_key: null,
    }];
    mocks.get.mockResolvedValue({
      date: "2026-08-10",
      startTime: null,
      endTime: null,
      completedDate: null,
      status: "In progress",
    });
  });

  it("returns a preview without any Notion or local mutation", async () => {
    const request = new Request("http://localhost/api/projects/demo/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "sync",
        confirmed: false,
        items: [{ client_request_id: "draft-1", name: "Deadline", date: "2026-08-10", type: "Deadline", start_time: null, end_time: null }],
      }),
    });
    const response = await POST(request, context);
    expect(response.status).toBe(200);
    expect((await response.json()).results[0].status).toBe("preview");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("finalizes a confirmed Notion item as a linked Mi milestone after the pending save", async () => {
    mocks.create.mockResolvedValue({
      id: "new-event-id",
      url: "https://www.notion.so/new-event-id",
    });
    const response = await POST(new Request("http://localhost/api/projects/demo/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "sync",
        confirmed: true,
        items: [{
          client_request_id: "draft-1",
          name: "Client review",
          date: "2026-08-14",
          type: "Deadline",
          start_time: null,
          end_time: null,
        }],
      }),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.write.mock.calls[1][1]).toContainEqual(expect.objectContaining({
      name: "Client review",
      notion_event_id: "new-event-id",
      sync_key: "draft-1",
    }));
    expect(mocks.currentHash).toHaveBeenCalledTimes(4);
  });

  it("rejects update mutations without the explicit confirmation flag", async () => {
    const request = new Request("http://localhost/api/projects/demo/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "milestone-1", plannedDate: "2026-08-10" }),
    });
    const response = await PATCH(request, context);
    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("rejects a stale expectedHash with a distinguishable conflict, before any Notion call", async () => {
    mocks.currentHash.mockReturnValue("real-current-hash");
    const request = new Request("http://localhost/api/projects/demo/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "milestone-1",
        plannedDate: "2026-08-10",
        actualDate: "2026-07-26",
        syncNotion: true,
        confirmed: true,
        expectedHash: "stale-hash-from-an-earlier-read",
      }),
    });
    const response = await PATCH(request, context);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("conflict");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.currentHash.mockReturnValue("current-hash");
  });

  it("proceeds when expectedHash matches and rejects an omitted reviewed hash", async () => {
    mocks.currentHash.mockReturnValue("matching-hash");
    const matching = await PATCH(new Request("http://localhost/api/projects/demo/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "milestone-1", plannedDate: "2026-08-10", actualDate: null, confirmed: true, expectedHash: "matching-hash",
      }),
    }), context);
    expect(matching.status).toBe(200);

    const omitted = await PATCH(new Request("http://localhost/api/projects/demo/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "milestone-1", plannedDate: "2026-08-11", actualDate: null, confirmed: true }),
    }), context);
    expect(omitted.status).toBe(409);
    expect((await omitted.json()).error).toMatch(/reload/i);
    mocks.currentHash.mockReturnValue("current-hash");
  });

  it("marks a linked milestone done with an exact completed date after confirmation", async () => {
    const request = new Request("http://localhost/api/projects/demo/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "milestone-1",
        plannedDate: "2026-08-10",
        actualDate: "2026-07-26",
        syncNotion: true,
        confirmed: true,
        expectedHash: "current-hash",
      }),
    });
    const response = await PATCH(request, context);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      eventPageId: "event-1",
      date: undefined,
      status: "Done",
      completedDate: "2026-07-26",
    });
    expect(mocks.write).toHaveBeenCalledWith("demo", [
      expect.objectContaining({ id: "milestone-1", actual_date: "2026-07-26" }),
    ], { expectedHash: "current-hash" });
  });

  it("reopens a linked milestone and clears completion in Mi and Notion", async () => {
    mocks.schedule.milestones[0].actual_date = "2026-07-20";
    mocks.get.mockResolvedValue({
      date: "2026-08-10",
      startTime: null,
      endTime: null,
      completedDate: "2026-07-20",
      status: "Done",
    });
    const request = new Request("http://localhost/api/projects/demo/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "milestone-1",
        plannedDate: "2026-08-10",
        actualDate: null,
        syncNotion: true,
        confirmed: true,
        expectedHash: "current-hash",
      }),
    });
    const response = await PATCH(request, context);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "In progress",
      completedDate: null,
    }));
    expect(mocks.write).toHaveBeenCalledWith("demo", [
      expect.objectContaining({ id: "milestone-1", actual_date: null }),
    ], { expectedHash: "current-hash" });
  });

  it("moves only the linked milestone date without rewriting its Notion status or relation", async () => {
    const request = new Request("http://localhost/api/projects/demo/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "milestone-1",
        plannedDate: "2026-08-12",
        actualDate: null,
        syncNotion: true,
        confirmed: true,
        expectedHash: "current-hash",
      }),
    });
    const response = await PATCH(request, context);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      eventPageId: "event-1",
      date: "2026-08-12",
      status: undefined,
      completedDate: undefined,
    });
  });

  it("blocks a linked milestone move when the live Notion date changed", async () => {
    mocks.get.mockResolvedValue({
      date: "2026-08-11",
      startTime: null,
      endTime: null,
      completedDate: null,
      status: "In progress",
    });
    const request = new Request("http://localhost/api/projects/demo/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "milestone-1",
        plannedDate: "2026-08-12",
        actualDate: null,
        syncNotion: true,
        confirmed: true,
        expectedHash: "current-hash",
      }),
    });
    const response = await PATCH(request, context);
    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("blocks a timed linked milestone move instead of splitting its date and time", async () => {
    mocks.get.mockResolvedValue({
      date: "2026-08-10",
      startTime: "2026-08-10T09:00:00-05:00",
      endTime: "2026-08-10T10:00:00-05:00",
      completedDate: null,
      status: "In progress",
    });
    const request = new Request("http://localhost/api/projects/demo/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "milestone-1",
        plannedDate: "2026-08-12",
        actualDate: null,
        syncNotion: true,
        confirmed: true,
        expectedHash: "current-hash",
      }),
    });
    const response = await PATCH(request, context);
    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("imports a confirmed Notion completion only after Submit refresh", async () => {
    mocks.query.mockResolvedValue([{
      id: "event-1",
      url: null,
      name: "Permit set",
      date: "2026-08-10",
      doDate: null,
      completedDate: "2026-07-25",
      status: "Done",
      type: ["Deadline"],
      hours: null,
    }]);
    const request = new Request("http://localhost/api/projects/demo/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "refresh-notion-status", confirmed: true }),
    });
    const response = await POST(request, context);
    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith("exact-project-id");
    expect(mocks.write).toHaveBeenCalledWith("demo", [
      expect.objectContaining({ id: "milestone-1", actual_date: "2026-07-25" }),
    ], { expectedHash: "current-hash" });
    expect(await response.json()).toMatchObject({ matched: 1, changed: 1 });
  });

  it("rejects save-local without the explicit confirmation flag", async () => {
    const request = new Request("http://localhost/api/projects/demo/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "save-local",
        confirmed: false,
        item: { client_request_id: "draft-1", name: "Site visit", date: "2026-08-01", type: "Meeting", start_time: null, end_time: null },
      }),
    });
    const response = await POST(request, context);
    expect(response.status).toBe(409);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("saves a confirmed local-only milestone without touching Notion, and is idempotent on retry", async () => {
    const body = JSON.stringify({
      operation: "save-local",
      confirmed: true,
      item: { client_request_id: "draft-1", name: "Site visit", date: "2026-08-01", type: "Meeting", start_time: null, end_time: null },
    });
    const first = await POST(new Request("http://localhost/api/projects/demo/schedule", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    }), context);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ saved: true, id: "local-draft-1" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    mocks.schedule.milestones = mocks.write.mock.calls[0][1];

    const second = await POST(new Request("http://localhost/api/projects/demo/schedule", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    }), context);
    expect(second.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("requires Submit confirmation before importing Notion statuses", async () => {
    const request = new Request("http://localhost/api/projects/demo/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "refresh-notion-status", confirmed: false }),
    });
    const response = await POST(request, context);
    expect(response.status).toBe(409);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
