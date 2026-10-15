import { beforeEach, describe, expect, it, vi } from "vitest";

const loadChatArchive = vi.fn();
const saveChatConversations = vi.fn();
vi.mock("@/lib/chat/archive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/archive")>();
  return { ...actual, loadChatArchive, saveChatConversations };
});
describe("/api/chat/history", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads a requested scope", async () => {
    loadChatArchive.mockReturnValue({ archive: { scopes: { main: [{ id: "one" }] } } });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/chat/history?scope=main"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ conversations: [{ id: "one" }] });
  });

  it("merges posted conversations", async () => {
    const entry = {
      id: "one", title: "One", engine: "codex", model: "", sessionId: null,
      messages: [], createdAt: 1, updatedAt: 2,
    };
    saveChatConversations.mockReturnValue([entry]);
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/chat/history", {
      method: "POST",
      body: JSON.stringify({ scope: "main", conversations: [entry] }),
    }));
    expect(response.status).toBe(200);
    expect(saveChatConversations).toHaveBeenCalledWith("main", [entry]);
  });
});
