import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadChatArchive,
  mergeArchivedConversations,
  saveChatConversations,
  type ArchivedConversation,
} from "./archive";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function conversation(id: string, updatedAt: number, text = id): ArchivedConversation {
  return {
    id,
    title: text,
    engine: "codex",
    model: "",
    sessionId: null,
    messages: [{ id: `${id}-message`, role: "user", text, createdAt: updatedAt }],
    createdAt: 1,
    updatedAt,
  };
}

describe("chat archive", () => {
  it("keeps the newest copy of each conversation", () => {
    expect(mergeArchivedConversations(
      [conversation("one", 2, "new"), conversation("two", 1)],
      [conversation("one", 1, "old"), conversation("three", 3)],
    ).map((entry) => entry.title)).toEqual(["three", "new", "two"]);
  });

  it("stores scopes independently and creates atomic backups", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-chat-archive-"));
    roots.push(root);
    saveChatConversations("main", [conversation("main", 1)], { root });
    saveChatConversations("leads", [conversation("lead", 2)], { root });
    saveChatConversations("main", [conversation("main", 3, "updated")], { root });

    const loaded = loadChatArchive({ root }).archive;
    expect(loaded.scopes.main?.[0].title).toBe("updated");
    expect(loaded.scopes.leads?.[0].id).toBe("lead");
    expect(fs.readdirSync(path.join(root, "backups")).length).toBeGreaterThan(0);
  });

  it("preserves the exact lead identity for lead-scoped history", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-chat-archive-"));
    roots.push(root);
    saveChatConversations("leads", [{ ...conversation("lead", 1), entitySlug: "demo-lead" }], { root });

    expect(loadChatArchive({ root }).archive.scopes.leads[0]?.entitySlug).toBe("demo-lead");
  });
});
