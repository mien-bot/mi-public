import { ROOT_PROJECT_VALUE, type AgentEngine, type ChatMessage, type ThreadKey, type ThreadState } from "./chatTypes";

export const CHAT_HISTORY_STORAGE_KEY = "mi:chatHistory:v1";
const MAX_THREADS = 48;
const MAX_MESSAGES_PER_THREAD = 100;
const MAX_MESSAGE_CHARACTERS = 100_000;
// Keep comfortably below common per-origin browser storage limits, including
// WebKit's accounting for UTF-16 strings, while leaving room for preferences.
export const MAX_SERIALIZED_HISTORY_CHARACTERS = 2_000_000;

interface HistoryStorage {
  getItem(key: string): string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.text !== "string" || typeof value.createdAt !== "number") return null;
  if (value.role !== "user" && value.role !== "assistant" && value.role !== "error") return null;
  return {
    id: value.id,
    role: value.role,
    text: value.text.slice(0, MAX_MESSAGE_CHARACTERS),
    createdAt: value.createdAt,
    pending: false,
  };
}

export function loadChatHistory(storage: HistoryStorage): Record<ThreadKey, ThreadState> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(CHAT_HISTORY_STORAGE_KEY) || "{}");
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).slice(-MAX_THREADS).flatMap(([key, value]) => {
        if (!isRecord(value) || !Array.isArray(value.messages)) return [];
        const messages = value.messages
          .slice(-MAX_MESSAGES_PER_THREAD)
          .map(readMessage)
          .filter((message): message is ChatMessage => Boolean(message));
        const legacyParts = key.split("::");
        const legacyEngine: AgentEngine = legacyParts[0] === "codex" ? "codex" : "claude";
        const legacyModel = legacyParts[1] === "default" ? "" : legacyParts[1] ?? "";
        const legacyProjectSlug = legacyParts.slice(2).join("::") || ROOT_PROJECT_VALUE;
        const firstUserText = messages.find((message) => message.role === "user")?.text.trim();
        const createdAt = typeof value.createdAt === "number"
          ? value.createdAt
          : messages[0]?.createdAt ?? Date.now();
        const updatedAt = typeof value.updatedAt === "number"
          ? value.updatedAt
          : messages.at(-1)?.createdAt ?? createdAt;
        const sessionId = typeof value.sessionId === "string" ? value.sessionId : null;
        return [[key, {
          messages,
          sessionId,
          activeRequestId: null,
          title: typeof value.title === "string" && value.title.trim()
            ? value.title.slice(0, 120)
            : firstUserText?.replace(/\s+/g, " ").slice(0, 60) || "New chat",
          engine: value.engine === "codex" || value.engine === "claude"
            ? value.engine
            : legacyEngine,
          model: typeof value.model === "string" ? value.model : legacyModel,
          projectSlug: typeof value.projectSlug === "string"
            ? value.projectSlug
            : legacyProjectSlug,
          createdAt,
          updatedAt,
        } satisfies ThreadState]];
      }),
    );
  } catch {
    return {};
  }
}

export function serializeChatHistory(threads: Record<ThreadKey, ThreadState>): string {
  const retained = Object.entries(threads)
    .sort(([, a], [, b]) => a.updatedAt - b.updatedAt)
    .slice(-MAX_THREADS)
    .map(([key, thread]) => [key, {
      sessionId: thread.sessionId,
      title: thread.title,
      engine: thread.engine,
      model: thread.model,
      projectSlug: thread.projectSlug,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: thread.messages.slice(-MAX_MESSAGES_PER_THREAD).map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text.slice(0, MAX_MESSAGE_CHARACTERS),
        createdAt: message.createdAt,
      })),
    }] as const);

  function entryChunk([key, thread]: (typeof retained)[number], messageCount = thread.messages.length) {
    return `${JSON.stringify(key)}:${JSON.stringify({
      ...thread,
      messages: thread.messages.slice(-messageCount),
    })}`;
  }

  function fitNewestEntry(entry: (typeof retained)[number], availableCharacters: number): string | null {
    let low = 0;
    let high = entry[1].messages.length;
    let best: string | null = null;
    while (low <= high) {
      const count = Math.floor((low + high) / 2);
      const candidate = entryChunk(entry, count);
      if (candidate.length <= availableCharacters) {
        best = candidate;
        low = count + 1;
      } else {
        high = count - 1;
      }
    }
    return best;
  }

  const chunks: string[] = [];
  let usedCharacters = 2; // The surrounding braces.
  for (let index = retained.length - 1; index >= 0; index -= 1) {
    const entry = retained[index];
    const chunk = entryChunk(entry);
    const separatorCharacters = chunks.length > 0 ? 1 : 0;
    if (usedCharacters + separatorCharacters + chunk.length <= MAX_SERIALIZED_HISTORY_CHARACTERS) {
      chunks.unshift(chunk);
      usedCharacters += separatorCharacters + chunk.length;
      continue;
    }

    // If even the newest conversation is unusually large, keep its newest
    // messages rather than failing the entire local history write.
    if (chunks.length === 0) {
      const fitted = fitNewestEntry(
        entry,
        MAX_SERIALIZED_HISTORY_CHARACTERS - usedCharacters,
      );
      if (fitted) {
        chunks.unshift(fitted);
        usedCharacters += fitted.length;
      }
    }
  }

  return `{${chunks.join(",")}}`;
}

/** Reconcile snapshots written by independent renderer windows. */
export function mergeChatHistories(
  current: Record<ThreadKey, ThreadState>,
  incoming: Record<ThreadKey, ThreadState>,
): Record<ThreadKey, ThreadState> {
  const merged = { ...current };
  for (const [key, thread] of Object.entries(incoming)) {
    if (!merged[key] || thread.updatedAt >= merged[key].updatedAt) merged[key] = thread;
  }
  return Object.fromEntries(
    Object.entries(merged)
      .sort(([, a], [, b]) => a.updatedAt - b.updatedAt)
      .slice(-MAX_THREADS),
  );
}
