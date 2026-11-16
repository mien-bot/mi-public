import { describe, expect, it, vi } from "vitest";
import type { Milestone, ScheduleDraftItem } from "@/lib/schema";
import { sendKeyFor, sendLocalMilestoneToNotion, syncScheduleItems } from "./notionScheduleSync";

function item(id: string, name = id): ScheduleDraftItem {
  return {
    client_request_id: id,
    name,
    date: "2026-08-10",
    type: "Deadline",
    start_time: null,
    end_time: null,
  };
}

function repository(initial: Milestone[] = []) {
  let milestones = initial;
  return {
    load: () => milestones,
    save: vi.fn((next: Milestone[]) => { milestones = next; }),
    current: () => milestones,
  };
}

describe("confirmation-gated Notion schedule sync", () => {
  it("cannot mutate Notion or local files during preview", async () => {
    const repo = repository();
    const create = vi.fn();
    const results = await syncScheduleItems({
      confirmed: false,
      projectPageId: "project-page",
      items: [item("draft-1")],
      repository: repo,
      adapter: { create },
    });
    expect(results[0].status).toBe("preview");
    expect(create).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("sets the exact project relation on every created item", async () => {
    const repo = repository();
    const create = vi.fn().mockResolvedValue({ id: "event-1", url: "https://notion.so/event-1" });
    await syncScheduleItems({
      confirmed: true,
      projectPageId: "exact-project-page-id",
      items: [item("draft-1")],
      repository: repo,
      adapter: { create },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      projectPageId: "exact-project-page-id",
      status: "Not started",
    }));
  });

  it("reports partial success and preserves an ambiguous attempt for review", async () => {
    const repo = repository();
    const create = vi.fn()
      .mockResolvedValueOnce({ id: "event-1", url: "https://notion.so/event-1" })
      .mockRejectedValueOnce(new Error("Notion unavailable"));
    const results = await syncScheduleItems({
      confirmed: true,
      projectPageId: "project-page",
      items: [item("draft-1"), item("draft-2")],
      repository: repo,
      adapter: { create },
    });
    expect(results.map((result) => result.status)).toEqual(["success", "pending-review"]);
    expect(repo.current()).toHaveLength(2);
    expect(repo.current()[1]).toMatchObject({
      sync_key: "draft-2",
      notion_event_id: null,
    });

    const retry = await syncScheduleItems({
      confirmed: true,
      projectPageId: "project-page",
      items: [item("draft-2")],
      repository: repo,
      adapter: { create },
    });
    expect(retry[0].status).toBe("pending-review");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("skips a previously successful client key on retry", async () => {
    const repo = repository();
    const create = vi.fn().mockResolvedValue({ id: "event-1", url: "https://notion.so/event-1" });
    const request = {
      confirmed: true,
      projectPageId: "project-page",
      items: [item("stable-draft-key")],
      repository: repo,
      adapter: { create },
    };
    await syncScheduleItems(request);
    const retry = await syncScheduleItems(request);
    expect(create).toHaveBeenCalledTimes(1);
    expect(retry[0].status).toBe("already-applied");
  });

  it("blocks a duplicate when a prior confirmed attempt is pending review", async () => {
    const repo = repository([{
      id: "pending-stable-key", name: "Deadline", planned_date: "2026-08-10",
      actual_date: null, notion_event_id: null, sync_key: "stable-key",
    }]);
    const create = vi.fn();
    const results = await syncScheduleItems({
      confirmed: true, projectPageId: "project-page", items: [item("stable-key")],
      repository: repo, adapter: { create },
    });
    expect(results[0].status).toBe("pending-review");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("sending a Mi-only item to Notion", () => {
  const local: Milestone = { id: "local-1", name: "Client walkthrough", planned_date: "2026-11-20", actual_date: null, notion_event_id: null, sync_key: null, type: "Client Meeting", start_time: "10:00" };
  function setup(first: Milestone = local) {
    const state = { milestones: [first] };
    return { state, repository: { load: () => state.milestones, save: (milestones: Milestone[]) => { state.milestones = milestones; } } };
  }
  const send = (repository: ReturnType<typeof setup>["repository"], create: ReturnType<typeof vi.fn>) => sendLocalMilestoneToNotion({
    id: "local-1", projectPageId: "project", startTime: "2026-11-20T10:00:00-06:00", endTime: "2026-11-20T11:00:00-06:00", repository, adapter: { create },
  });

  it("links the same item, with its type and time, and does not add a second one", async () => {
    const { state, repository } = setup();
    const create = vi.fn().mockResolvedValue({ id: "event-1", url: "u" });
    expect((await send(repository, create)).status).toBe("success");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ projectPageId: "project", type: "Client Meeting", startTime: "2026-11-20T10:00:00-06:00", status: "Not started" }));
    expect(state.milestones).toEqual([expect.objectContaining({ id: "local-1", notion_event_id: "event-1" })]);
  });

  it("does nothing the second time", async () => {
    const { repository } = setup();
    const create = vi.fn().mockResolvedValue({ id: "event-1", url: "u" });
    await send(repository, create);
    expect((await send(repository, create)).status).toBe("already-applied");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("sends a finished item as done", async () => {
    const { repository } = setup({ ...local, actual_date: "2026-11-01" });
    const create = vi.fn().mockResolvedValue({ id: "event-1", url: "u" });
    await send(repository, create);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: "Done", completedDate: "2026-11-01" }));
  });

  it("allows a retry when Notion clearly refused", async () => {
    const { state, repository } = setup();
    const result = await send(repository, vi.fn().mockRejectedValue(new Error("Notion API 400 Bad Request: validation_error")));
    expect(result.status).toBe("failed");
    expect(state.milestones[0].sync_key).toBeNull();
  });

  it("marks nothing when Notion is not reachable or set up, so nothing needs checking", async () => {
    const { state, repository } = setup();
    const create = vi.fn();
    const result = await sendLocalMilestoneToNotion({
      id: "local-1", projectPageId: "project", startTime: null, endTime: null, repository, adapter: { create },
      ready: () => Promise.reject(new Error("Could not find a STUDIO Schedule database")),
    });
    expect(result.status).toBe("failed");
    expect(create).not.toHaveBeenCalled();
    expect(state.milestones[0].sync_key).toBeNull();
  });

  it("blocks a retry when the reply was lost, so a second row cannot appear", async () => {
    const { state, repository } = setup();
    const create = vi.fn().mockRejectedValue(new Error("fetch failed"));
    expect((await send(repository, create)).status).toBe("pending-review");
    expect(state.milestones[0].sync_key).toBe(sendKeyFor(local));
    expect((await send(repository, create)).status).toBe("pending-review");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
