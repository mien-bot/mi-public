import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
  append: vi.fn(),
}));

vi.mock("@/lib/personal/store", () => ({
  loadPersonalDatabase: mocks.load,
  createPersonalRecord: mocks.create,
  deletePersonalRecord: mocks.delete,
  updatePersonalRecord: mocks.update,
  appendPersonalConversation: mocks.append,
}));

import { GET, POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/personal/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("personal record route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockReturnValue({
      database: { schemaVersion: 1, records: [], conversation: [], conversations: [], updatedAt: "2026-08-01T00:00:00.000Z" },
      hash: null,
    });
  });

  it("reads local data without mutating it", async () => {
    expect((await GET()).status).toBe(200);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("requires confirmation and an exact database hash for writes", async () => {
    expect((await POST(request({ operation: "create", expectedHash: null }))).status).toBe(409);
    expect((await POST(request({ operation: "create", confirmed: true }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("accepts a reviewed record with an explicit null first-write hash", async () => {
    const record = {
      kind: "thought",
      title: "An idea",
      body: "Keep this local",
      tags: [],
      mood: null,
      status: "inbox",
      schedule: null,
    };
    const response = await POST(request({
      operation: "create",
      record,
      confirmed: true,
      expectedHash: null,
    }));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(record, null);
  });

  it("limits one conversation append to one user/assistant pair", async () => {
    const response = await POST(request({
      operation: "append-conversation",
      confirmed: true,
      expectedHash: null,
      messages: [
        { role: "user", text: "hello" },
        { role: "assistant", text: "hi" },
        { role: "assistant", text: "extra" },
      ],
    }));
    expect(response.status).toBe(400);
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("deletes only the exact explicitly confirmed record", async () => {
    const response = await POST(request({
      operation: "delete",
      id: "record-1",
      confirmed: true,
      expectedHash: "current-hash",
    }));

    expect(response.status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledWith("record-1", "current-hash");
  });
});
