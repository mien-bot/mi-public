import { describe, expect, it } from "vitest";
import {
  CHAT_HISTORY_STORAGE_KEY,
  loadChatHistory,
  MAX_SERIALIZED_HISTORY_CHARACTERS,
  mergeChatHistories,
  serializeChatHistory,
} from "./chatHistory";

describe("local chat history", () => {
  it("round-trips text and session ids without restoring in-flight state", () => {
    const raw = serializeChatHistory({
      "codex::default::demo": {
        sessionId: "session-1",
        activeRequestId: "request-1",
        title: "Still working",
        engine: "codex",
        model: "",
        projectSlug: "demo",
        createdAt: 1,
        updatedAt: 10,
        messages: [{ id: "m1", role: "assistant", text: "Still working", createdAt: 10, pending: true }],
      },
    });
    const loaded = loadChatHistory({ getItem: (key) => key === CHAT_HISTORY_STORAGE_KEY ? raw : null });

    expect(loaded["codex::default::demo"]).toMatchObject({
      sessionId: "session-1",
      activeRequestId: null,
      engine: "codex",
      model: "",
      projectSlug: "demo",
      messages: [{ id: "m1", role: "assistant", text: "Still working", createdAt: 10, pending: false }],
    });
  });

  it("fails closed on malformed local data", () => {
    expect(loadChatHistory({ getItem: () => "not json" })).toEqual({});
    expect(loadChatHistory({ getItem: () => JSON.stringify({ broken: { messages: [null] } }) })).toEqual({
      broken: expect.objectContaining({ sessionId: null, activeRequestId: null, messages: [] }),
    });
  });

  it("keeps the newest copy and conversations created in another window", () => {
    const read = (value: object) => loadChatHistory({ getItem: () => JSON.stringify(value) });
    const common = {
      messages: [], engine: "codex", model: "", projectSlug: "__root__",
      sessionId: null, createdAt: 1,
    };
    const merged = mergeChatHistories(
      read({ shared: { ...common, title: "Newer", updatedAt: 3 } }),
      read({
        shared: { ...common, title: "Older", updatedAt: 2 },
        separate: { ...common, title: "Other window", updatedAt: 4 },
      }),
    );
    expect(merged.shared.title).toBe("Newer");
    expect(merged.separate.title).toBe("Other window");
  });

  it("keeps local history below browser storage limits while preserving the newest conversation", () => {
    const threads = Object.fromEntries(Array.from({ length: 48 }, (_, threadIndex) => {
      const key = `codex::default::project-${threadIndex}`;
      return [key, {
        sessionId: `session-${threadIndex}`,
        activeRequestId: null,
        title: `Conversation ${threadIndex}`,
        engine: "codex" as const,
        model: "",
        projectSlug: `project-${threadIndex}`,
        createdAt: threadIndex,
        updatedAt: threadIndex,
        messages: Array.from({ length: 100 }, (_, messageIndex) => ({
          id: `${threadIndex}-${messageIndex}`,
          role: "assistant" as const,
          text: "x".repeat(2_000),
          createdAt: messageIndex,
        })),
      }];
    }));

    const raw = serializeChatHistory(threads);
    const loaded = loadChatHistory({ getItem: () => raw });

    expect(raw.length).toBeLessThanOrEqual(MAX_SERIALIZED_HISTORY_CHARACTERS);
    expect(loaded["codex::default::project-47"]?.messages.at(-1)?.id).toBe("47-99");
    expect(Object.keys(loaded).length).toBeLessThan(48);
  });

  it("keeps the newest messages when one conversation exceeds the local history budget", () => {
    const raw = serializeChatHistory({
      oversized: {
        sessionId: "session-large",
        activeRequestId: null,
        title: "Large conversation",
        engine: "claude",
        model: "",
        projectSlug: "__root__",
        createdAt: 1,
        updatedAt: 2,
        messages: Array.from({ length: 100 }, (_, index) => ({
          id: `message-${index}`,
          role: "assistant",
          text: "x".repeat(30_000),
          createdAt: index,
        })),
      },
    });
    const loaded = loadChatHistory({ getItem: () => raw });

    expect(raw.length).toBeLessThanOrEqual(MAX_SERIALIZED_HISTORY_CHARACTERS);
    expect(loaded.oversized.messages.length).toBeLessThan(100);
    expect(loaded.oversized.messages.at(-1)?.id).toBe("message-99");
  });
});
