import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  finish: vi.fn(),
  clear: vi.fn(),
  load: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/src/audit/log", () => ({ recordAudit: mocks.audit }));
vi.mock("@/lib/personal/store", () => ({
  preparePersonalCalendarShare: mocks.prepare,
  finishPersonalCalendarShare: mocks.finish,
  clearPersonalCalendarShareReview: mocks.clear,
  loadPersonalDatabase: mocks.load,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/personal/calendar-share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("personal calendar share state route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockReturnValue({ database: { records: [] }, hash: "current-hash" });
    mocks.prepare.mockReturnValue({
      record: { schedule: { name: "Dentist", date: "2026-08-10", type: "Meeting", startTime: null, endTime: null } },
      syncKey: "sync-key",
      hash: "pending-hash",
    });
  });

  it("requires explicit confirmation before preparing a write", async () => {
    const response = await POST(request({ operation: "prepare", id: "record-1", expectedHash: "hash" }));
    expect(response.status).toBe(409);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("returns only the pending key and reviewed schedule needed by the privileged writer", async () => {
    const response = await POST(request({ operation: "prepare", id: "record-1", expectedHash: "hash", confirmed: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      syncKey: "sync-key",
      schedule: { name: "Dentist", date: "2026-08-10" },
    });
    expect(mocks.prepare).toHaveBeenCalledWith("record-1", "hash");
  });

  it("finalizes only a validated privileged Notion result", async () => {
    const response = await POST(request({
      operation: "finish",
      id: "record-1",
      syncKey: "sync-key",
      expectedHash: "pending-hash",
      confirmed: true,
      result: { status: "shared", notionPageId: "page-id", notionUrl: "https://www.notion.so/page-id" },
    }));
    expect(response.status).toBe(200);
    expect(mocks.finish).toHaveBeenCalledWith(
      "record-1",
      "sync-key",
      "pending-hash",
      { status: "shared", notionPageId: "page-id", notionUrl: "https://www.notion.so/page-id" },
    );

    const refused = await POST(request({
      operation: "finish",
      id: "record-1",
      syncKey: "sync-key",
      expectedHash: "pending-hash",
      confirmed: true,
      result: { status: "shared", notionPageId: "page-id", notionUrl: "javascript:alert(1)" },
    }));
    expect(refused.status).toBe(400);
  });

  it("requires a human check before clearing an ambiguous create", async () => {
    const refused = await POST(request({
      operation: "clear-review",
      id: "record-1",
      expectedHash: "pending-hash",
      confirmed: true,
    }));
    expect(refused.status).toBe(409);
    expect(mocks.clear).not.toHaveBeenCalled();

    const cleared = await POST(request({
      operation: "clear-review",
      id: "record-1",
      expectedHash: "pending-hash",
      confirmed: true,
      resolution: "confirmed-not-created",
    }));
    expect(cleared.status).toBe(200);
    expect(mocks.clear).toHaveBeenCalledWith("record-1", "pending-hash");
  });
});
