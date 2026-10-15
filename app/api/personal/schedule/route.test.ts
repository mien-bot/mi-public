import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowed: vi.fn(() => true),
  prepare: vi.fn(),
  finish: vi.fn(),
  clear: vi.fn(),
  load: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/src/policies/approvals", () => ({ isWriteAllowed: mocks.allowed }));
vi.mock("@/src/audit/log", () => ({ recordAudit: mocks.audit }));
vi.mock("@/src/adapters/notion/schedule", () => ({ createPersonalScheduleEntry: mocks.create }));
vi.mock("@/lib/personal/store", () => ({
  preparePersonalShare: mocks.prepare,
  finishPersonalShare: mocks.finish,
  clearPersonalShareReview: mocks.clear,
  loadPersonalDatabase: mocks.load,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/personal/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const prepared = {
  record: {
    id: "record-1",
    schedule: {
      name: "Focus block",
      date: "2026-08-05",
      type: "Work Session",
      startTime: null,
      endTime: null,
    },
  },
  syncKey: "sync-1",
  hash: "pending-hash",
};

describe("personal STUDIO sharing route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.allowed.mockReturnValue(true);
    mocks.prepare.mockReturnValue(prepared);
    mocks.create.mockResolvedValue({ id: "notion-page", url: "https://www.notion.so/notion-page" });
    mocks.finish.mockReturnValue({ database: { records: [] }, hash: "shared-hash" });
    mocks.clear.mockReturnValue({ database: { records: [] }, hash: "cleared-hash" });
    mocks.load.mockReturnValue({ database: { records: [] }, hash: "loaded-hash" });
  });

  it("requires a separate explicit confirmation before any local or external mutation", async () => {
    const response = await POST(request({ id: "record-1", expectedHash: "hash" }));
    expect(response.status).toBe(409);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("honors the configured Notion write allowlist", async () => {
    mocks.allowed.mockReturnValue(false);
    const response = await POST(request({
      id: "record-1",
      expectedHash: "hash",
      confirmed: true,
    }));
    expect(response.status).toBe(409);
    expect(mocks.allowed).toHaveBeenCalledWith("schedule", "create");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("sends only the reviewed schedule object and finalizes its two-phase state", async () => {
    const response = await POST(request({
      id: "record-1",
      expectedHash: "hash",
      confirmed: true,
    }));
    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith("record-1", "hash");
    expect(mocks.create).toHaveBeenCalledWith(prepared.record.schedule);
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("body");
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("tags");
    expect(mocks.finish).toHaveBeenCalledWith(
      "record-1",
      "sync-1",
      "pending-hash",
      {
        status: "shared",
        notionPageId: "notion-page",
        notionUrl: "https://www.notion.so/notion-page",
      },
    );
  });

  it("marks an ambiguous failure for manual review and blocks blind retry", async () => {
    mocks.create.mockRejectedValue(new Error("network timeout"));
    mocks.finish.mockReturnValue({ database: { records: [] }, hash: "review-hash" });
    const response = await POST(request({
      id: "record-1",
      expectedHash: "hash",
      confirmed: true,
    }));
    expect(response.status).toBe(502);
    expect(mocks.finish).toHaveBeenCalledWith(
      "record-1",
      "sync-1",
      "pending-hash",
      { status: "needs-review", message: "network timeout" },
    );
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("blocked automatic retry") });
  });

  it("requires a human-confirmed STUDIO check before clearing an ambiguous attempt", async () => {
    mocks.allowed.mockReturnValue(false);
    const refused = await POST(request({
      id: "record-1",
      operation: "clear-review",
      expectedHash: "review-hash",
      confirmed: true,
    }));
    expect(refused.status).toBe(409);
    expect(mocks.clear).not.toHaveBeenCalled();

    const cleared = await POST(request({
      id: "record-1",
      operation: "clear-review",
      resolution: "confirmed-not-created",
      expectedHash: "review-hash",
      confirmed: true,
    }));
    expect(cleared.status).toBe(200);
    expect(mocks.clear).toHaveBeenCalledWith("record-1", "review-hash");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
