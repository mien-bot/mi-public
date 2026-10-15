import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import {
  appendPersonalConversation,
  clearPersonalShareReview,
  clearPersonalCalendarShareReview,
  createPersonalRecord,
  deletePersonalRecord,
  finishPersonalShare,
  finishPersonalCalendarShare,
  importPersonalRecords,
  loadPersonalDatabase,
  preparePersonalShare,
  preparePersonalCalendarShare,
  updatePersonalRecord,
} from "./store";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-personal-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Mi-local personal store", () => {
  it("creates an atomic private database and preserves reviewed fields", () => {
    const root = temporaryRoot();
    const created = createPersonalRecord({
      kind: "journal",
      title: "Morning reflection",
      body: "A private thought",
      tags: ["reflection"],
      mood: "clear",
      status: "inbox",
      schedule: null,
    }, null, { root });

    expect(created.database.records[0]).toMatchObject({
      kind: "journal",
      title: "Morning reflection",
      body: "A private thought",
      share: { status: "local" },
    });
    expect(created.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(loadPersonalDatabase({ root }).database.records).toHaveLength(1);
    expect(fs.readdirSync(root)).toContain("records.json");
  });

  it("imports a reviewed Obsidian batch in one atomic database write", () => {
    const root = temporaryRoot();
    const imported = importPersonalRecords([
      { kind: "thought", title: "Imported note", body: "Markdown body", tags: ["obsidian"], mood: null, status: "inbox", schedule: null },
      { kind: "plan", title: "Imported plan", body: "", tags: [], mood: null, status: "active", schedule: null },
    ], null, { root });

    expect(imported.records).toHaveLength(2);
    expect(imported.database.records.map((record) => record.title)).toEqual(["Imported note", "Imported plan"]);
    expect(imported.database.records.every((record) => record.share.status === "local")).toBe(true);
    expect(imported.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses stale writes instead of losing another window's changes", () => {
    const root = temporaryRoot();
    const first = createPersonalRecord({
      kind: "thought",
      title: "One",
      body: "",
      tags: [],
      mood: null,
      status: "inbox",
      schedule: null,
    }, null, { root });
    createPersonalRecord({
      kind: "thought",
      title: "Two",
      body: "",
      tags: [],
      mood: null,
      status: "inbox",
      schedule: null,
    }, first.hash, { root });

    expect(() => appendPersonalConversation(
      [{ role: "user", text: "stale" }],
      first.hash,
      { root },
    )).toThrow(ContentConflictError);
    expect(loadPersonalDatabase({ root }).database.records).toHaveLength(2);
  });

  it("persists conversation locally and caps retained history", () => {
    const root = temporaryRoot();
    const messages = Array.from({ length: 200 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      text: `message ${index}`,
    }));
    const first = appendPersonalConversation(messages.slice(0, 2), null, { root });
    let hash = first.hash;
    for (let index = 2; index < messages.length; index += 2) {
      hash = appendPersonalConversation(messages.slice(index, index + 2), hash, { root }).hash;
    }
    const final = appendPersonalConversation([
      { role: "user", text: "newest user" },
      { role: "assistant", text: "newest assistant" },
    ], hash, { root });
    expect(final.database.conversations).toHaveLength(1);
    expect(final.database.conversations[0].messages).toHaveLength(200);
    expect(final.database.conversations[0].messages.at(-1)?.text).toBe("newest assistant");
    expect(final.database.conversations[0].messages[0].text).toBe("message 2");
    expect(fs.readdirSync(path.join(root, "backups")).length).toBeLessThanOrEqual(25);
  }, 15_000);

  it("keeps separate revivable conversations and resumes their stored agent session", () => {
    const root = temporaryRoot();
    const first = appendPersonalConversation(
      [{ role: "user", text: "Balance my workload" }],
      null,
      { root },
      { id: "chat-one", sessionId: "session-one", engine: "claude", model: "claude-sonnet-5" },
    );
    const second = appendPersonalConversation(
      [{ role: "user", text: "Plan tomorrow" }],
      first.hash,
      { root },
      { id: "chat-two", sessionId: "session-two", engine: "codex", model: "gpt-5.6-terra" },
    );

    expect(second.database.conversations.map((entry) => entry.id)).toEqual(["chat-two", "chat-one"]);
    expect(second.database.conversations[1]).toMatchObject({
      title: "Balance my workload",
      sessionId: "session-one",
      engine: "claude",
      model: "claude-sonnet-5",
    });
  });

  it("deletes a confirmed local record without changing its neighbors", () => {
    const root = temporaryRoot();
    const first = createPersonalRecord({
      kind: "task",
      title: "Remove me",
      body: "",
      tags: [],
      mood: null,
      status: "active",
      schedule: null,
    }, null, { root });
    const second = createPersonalRecord({
      kind: "thought",
      title: "Keep me",
      body: "",
      tags: [],
      mood: null,
      status: "inbox",
      schedule: null,
    }, first.hash, { root });

    const deleted = deletePersonalRecord(first.record.id, second.hash, { root });

    expect(deleted.deletedId).toBe(first.record.id);
    expect(deleted.database.records.map((record) => record.title)).toEqual(["Keep me"]);
    expect(fs.readdirSync(path.join(root, "backups")).length).toBeGreaterThan(0);
  });

  it("preserves unresolved STUDIO share state instead of deleting its local reconciliation key", () => {
    const root = temporaryRoot();
    const created = createPersonalRecord({
      kind: "plan",
      title: "Pending plan",
      body: "",
      tags: [],
      mood: null,
      status: "active",
      schedule: {
        name: "Pending plan",
        date: "2026-08-05",
        type: "Work Session",
        startTime: null,
        endTime: null,
      },
    }, null, { root });
    const prepared = preparePersonalShare(created.record.id, created.hash, { root });

    expect(() => deletePersonalRecord(created.record.id, prepared.hash, { root }))
      .toThrow(/Resolve the pending STUDIO share review/);
    expect(loadPersonalDatabase({ root }).database.records).toHaveLength(1);
  });

  it("uses a two-phase share state and blocks duplicate or silent schedule edits", () => {
    const root = temporaryRoot();
    const created = createPersonalRecord({
      kind: "plan",
      title: "Focus block",
      body: "Private reason",
      tags: ["private"],
      mood: "focused",
      status: "active",
      schedule: {
        name: "Focus block",
        date: "2026-08-05",
        type: "Work Session",
        startTime: null,
        endTime: null,
      },
    }, null, { root });
    const prepared = preparePersonalShare(created.record.id, created.hash, { root });
    expect(prepared.record.share.status).toBe("pending");
    expect(() => preparePersonalShare(created.record.id, prepared.hash, { root })).toThrow(/needs review/);

    const shared = finishPersonalShare(
      created.record.id,
      prepared.syncKey,
      prepared.hash,
      {
        status: "shared",
        notionPageId: "notion-page",
        notionUrl: "https://www.notion.so/notion-page",
      },
      { root },
    );
    expect(shared.record.share.status).toBe("shared");
    expect(() => updatePersonalRecord(
      created.record.id,
      { schedule: { ...created.record.schedule!, date: "2026-08-06" } },
      shared.hash,
      { root },
    )).toThrow(/cannot be silently changed/);
  });

  it("allows retry only after a human-confirmed ambiguous-write review", () => {
    const root = temporaryRoot();
    const created = createPersonalRecord({
      kind: "plan",
      title: "Appointment",
      body: "Private details",
      tags: [],
      mood: null,
      status: "active",
      schedule: {
        name: "Appointment",
        date: "2026-08-12",
        type: "Meeting",
        startTime: null,
        endTime: null,
      },
    }, null, { root });
    const prepared = preparePersonalShare(created.record.id, created.hash, { root });
    const ambiguous = finishPersonalShare(
      created.record.id,
      prepared.syncKey,
      prepared.hash,
      { status: "needs-review", message: "network timeout" },
      { root },
    );
    expect(() => preparePersonalShare(created.record.id, ambiguous.hash, { root })).toThrow(/needs review/);
    const cleared = clearPersonalShareReview(created.record.id, ambiguous.hash, { root });
    expect(cleared.record.share).toEqual({ status: "local" });
    expect(preparePersonalShare(created.record.id, cleared.hash, { root }).syncKey).not.toBe(prepared.syncKey);
  });

  it("tracks STUDIO and personal calendar sharing independently", () => {
    const root = temporaryRoot();
    const created = createPersonalRecord({
      kind: "task",
      title: "Submit reimbursement",
      body: "Private receipt details",
      tags: [],
      mood: null,
      status: "active",
      schedule: {
        name: "Submit reimbursement",
        date: "2026-08-12",
        type: "Deadline",
        startTime: null,
        endTime: null,
      },
    }, null, { root });
    const personalPrepared = preparePersonalCalendarShare(created.record.id, created.hash, { root });
    expect(personalPrepared.record.share).toEqual({ status: "local" });
    expect(personalPrepared.record.personalCalendarShare?.status).toBe("pending");
    const personalShared = finishPersonalCalendarShare(
      created.record.id,
      personalPrepared.syncKey,
      personalPrepared.hash,
      { status: "shared", notionPageId: "personal-page", notionUrl: "https://www.notion.so/personal-page" },
      { root },
    );
    expect(personalShared.record.personalCalendarShare?.status).toBe("shared");
    expect(personalShared.record.share).toEqual({ status: "local" });

    const studioPrepared = preparePersonalShare(created.record.id, personalShared.hash, { root });
    const ambiguous = finishPersonalShare(
      created.record.id,
      studioPrepared.syncKey,
      studioPrepared.hash,
      { status: "needs-review", message: "timeout" },
      { root },
    );
    const cleared = clearPersonalShareReview(created.record.id, ambiguous.hash, { root });
    expect(cleared.record.personalCalendarShare?.status).toBe("shared");
    expect(() => clearPersonalCalendarShareReview(created.record.id, cleared.hash, { root }))
      .toThrow(/does not have a share attempt/);
  });
});
