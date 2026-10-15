import { describe, expect, it, vi } from "vitest";
import type { WorkLogEntry } from "@/lib/schema";
import { syncWorklogEntry } from "./worklogSync";

const draft = {
  name: "Drawing coordination",
  date: "2026-07-26",
  hours: 2.5,
  attendees: ["Example User"],
  notes: "Reviewed the reflected ceiling plan.",
};

function repository(seed: WorkLogEntry[] = []) {
  let entries = seed;
  return {
    load: vi.fn(() => entries),
    save: vi.fn((next: WorkLogEntry[]) => { entries = next; }),
    current: () => entries,
  };
}

describe("worklog synchronization", () => {
  it("does not read, write, or call Notion during preview", async () => {
    const repo = repository();
    const create = vi.fn();
    const result = await syncWorklogEntry({
      confirmed: false,
      syncKey: "hours-1",
      projectPageId: "project-page",
      attendeeIds: ["person-1"],
      draft,
      repository: repo,
      adapter: { create },
    });
    expect(result.status).toBe("preview");
    expect(repo.load).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("persists a pending key before creating a confirmed Notion entry", async () => {
    const repo = repository();
    const create = vi.fn(async () => ({ id: "event-1", url: "https://www.notion.so/event-1" }));
    const result = await syncWorklogEntry({
      confirmed: true,
      syncKey: "hours-1",
      projectPageId: "project-page",
      attendeeIds: ["person-1"],
      draft,
      repository: repo,
      adapter: { create },
    });
    expect(result.status).toBe("success");
    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(repo.save.mock.calls[0][0][0].notion_event_id).toBeNull();
    expect(repo.current()[0].notion_event_id).toBe("event-1");
  });

  it("blocks duplicate and ambiguous retries", async () => {
    const pending: WorkLogEntry = {
      id: "pending-hours-1",
      ...draft,
      notion_event_id: null,
      notion_url: null,
      sync_key: "hours-1",
    };
    const repo = repository([pending]);
    const create = vi.fn();
    const result = await syncWorklogEntry({
      confirmed: true,
      syncKey: "hours-1",
      projectPageId: "project-page",
      attendeeIds: ["person-1"],
      draft,
      repository: repo,
      adapter: { create },
    });
    expect(result.status).toBe("pending-review");
    expect(create).not.toHaveBeenCalled();
  });
});
