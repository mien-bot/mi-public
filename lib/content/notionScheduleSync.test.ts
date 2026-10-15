import { describe, expect, it, vi } from "vitest";
import type { Milestone, ScheduleDraftItem } from "@/lib/schema";
import { syncScheduleItems } from "./notionScheduleSync";

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
