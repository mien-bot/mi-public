import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  countReviewCards,
  effectiveContent,
  readReviewCardsIn,
  reviewCardContentSchema,
  syncReviewInboxIn,
  updateReviewCardIn,
  type ReviewInboxLocation,
} from "./reviewInbox";
import { hashContent } from "./atomicContentWrite";
import { outboxEntryId } from "./workspaceOutbox";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function location(kind: ReviewInboxLocation["kind"] = "lead", slug = "1000-w-example-blvd"): ReviewInboxLocation {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-review-"));
  roots.push(root);
  const inbox = path.join(root, "workspace", "Mi", "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const recordDir = path.join(root, "record");
  fs.mkdirSync(recordDir, { recursive: true });
  return {
    kind,
    slug,
    inbox,
    resolutions: path.join(recordDir, ".mi", "outbox-resolutions.json"),
    cards: path.join(recordDir, ".mi", "review-inbox.json"),
    settings: path.join(recordDir, ".mi", "review-inbox-settings.json"),
  };
}

/** Exactly the shape documented for agents, including the local-offset timestamp. */
function meetingEntry(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    kind: "meeting",
    created_at: "2026-08-15T15:14:29.167-05:00",
    session: { id: "codex-session-id", agent: "codex" },
    workspace: { type: "lead", slug: "1000-w-example-blvd" },
    visibility: "internal",
    title: "Owner walkthrough",
    body: "Attendees: Casey, Alex\n\n## Summary\nWalked the second floor.\n\n## Decisions\n- Keep the existing stair.",
    why: "The stair decision changes the plan set.",
    evidence: [],
    targets: [],
    needs_confirmation: true,
    ...overrides,
  };
}

function write(place: ReviewInboxLocation, name: string, body: unknown): void {
  fs.writeFileSync(
    path.join(place.inbox, name),
    typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`,
  );
}

describe("syncReviewInboxIn", () => {
  it("recovers a formerly failed import from PowerShell UTF-8 without changing source bytes", () => {
    const place = location();
    write(place, "powershell.json", "invalid JSON");
    const failed = syncReviewInboxIn(place).failedImports[0];
    const raw = `\uFEFF${JSON.stringify(meetingEntry())}`;
    write(place, "powershell.json", raw);
    const result = syncReviewInboxIn(place);
    expect(result.failedImports).toHaveLength(0);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]).toMatchObject({ status: "pending", source: { hash: hashContent(raw) } });
    expect(result.cards.find(card => card.id === failed.id)?.status).toBe("superseded");
    expect(fs.readFileSync(path.join(place.inbox, "powershell.json"), "utf8")).toBe(raw);
    expect(syncReviewInboxIn(place).imported).toHaveLength(0);
  });

  it("imports a documented entry as a pending card and records where it came from", () => {
    const place = location();
    write(place, "entry-one.json", meetingEntry());

    const result = syncReviewInboxIn(place, { now: () => new Date("2026-08-15T21:00:00.000Z") });

    expect(result.imported).toHaveLength(1);
    const [card] = result.cards;
    expect(card).toMatchObject({
      status: "pending",
      entry_kind: "meeting",
      visibility: "internal",
      needs_confirmation: true,
      imported_at: "2026-08-15T21:00:00.000Z",
      reviewed_at: null,
      source: {
        file_name: "entry-one.json",
        path: "Mi/inbox/entry-one.json",
        session_id: "codex-session-id",
        agent: "codex",
        created_at: "2026-08-15T15:14:29.167-05:00",
      },
    });
    expect(card.source.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(effectiveContent(card)?.title).toBe("Owner walkthrough");
  });

  it("derives the id from content when the file carries none, so a hand-dropped file imports once", () => {
    const place = location();
    // The published contract does not require an id -- an entry that omits it still has to
    // land on exactly one card.
    write(place, "entry-one.json", meetingEntry());
    const first = syncReviewInboxIn(place);
    expect(first.cards[0].id).toBe(outboxEntryId({
      kind: "meeting",
      workspace: { type: "lead", slug: "1000-w-example-blvd" },
      title: "Owner walkthrough",
      body: meetingEntry().body as string,
      why: "The stair decision changes the plan set.",
      targets: [],
    }));

    const second = syncReviewInboxIn(place);
    expect(second.imported).toHaveLength(0);
    expect(second.cards).toHaveLength(1);
  });

  it("does not duplicate after a restart, a re-sync, or the same finding arriving under another name", () => {
    const place = location();
    write(place, "entry-one.json", meetingEntry());
    syncReviewInboxIn(place);

    // Dropbox delivering the same bytes under a second name, and a second session recording
    // the same finding at a different time, must both collapse onto the existing card.
    write(place, "entry-copy.json", meetingEntry());
    write(place, "entry-later.json", meetingEntry({
      created_at: "2026-08-16T09:00:00.000-05:00",
      session: { id: "claude-session", agent: "claude" },
    }));
    const result = syncReviewInboxIn(place);

    expect(result.imported).toHaveLength(0);
    expect(result.cards).toHaveLength(1);
    expect(fs.readdirSync(place.inbox)).toHaveLength(3);
  });

  it("never edits or deletes the original file", () => {
    const place = location();
    write(place, "entry-one.json", meetingEntry());
    const before = fs.readFileSync(path.join(place.inbox, "entry-one.json"), "utf8");

    syncReviewInboxIn(place);
    updateReviewCardIn(place, readReviewCardsIn(place)[0].id, { status: "dismissed" });
    syncReviewInboxIn(place);

    expect(fs.readFileSync(path.join(place.inbox, "entry-one.json"), "utf8")).toBe(before);
  });

  it("raises a failed-import item for invalid JSON instead of discarding the file", () => {
    const place = location();
    write(place, "broken.json", "{ not json");

    const result = syncReviewInboxIn(place);

    expect(result.failedImports).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      status: "failed",
      source: { file_name: "broken.json" },
      failure: { stage: "import", reason: "The file is not valid JSON." },
    });
    expect(fs.existsSync(path.join(place.inbox, "broken.json"))).toBe(true);
  });

  it("names the offending field when a file parses but does not validate", () => {
    const place = location();
    const withoutVisibility: Record<string, unknown> = { ...meetingEntry() };
    delete withoutVisibility.visibility;
    write(place, "no-visibility.json", withoutVisibility);

    const [card] = syncReviewInboxIn(place).cards;
    expect(card.status).toBe("failed");
    expect(card.failure?.reason).toContain("visibility");
  });

  it("closes the failed item out when the file is corrected, pointing at the entry it became", () => {
    const place = location();
    write(place, "entry-one.json", "{ not json");
    const failedId = syncReviewInboxIn(place).cards[0].id;

    write(place, "entry-one.json", meetingEntry());
    const result = syncReviewInboxIn(place);

    const failed = result.cards.find((card) => card.id === failedId);
    const imported = result.cards.find((card) => card.status === "pending");
    expect(failed?.status).toBe("superseded");
    expect(failed?.superseded_by).toEqual([imported?.id]);
    expect(countReviewCards(result.cards)).toMatchObject({ pending: 1, failed: 0, superseded: 1 });
  });

  it("skips entries addressed to a different workspace without reporting them as failures", () => {
    const place = location("lead", "1000-w-example-blvd");
    write(place, "elsewhere.json", meetingEntry({ workspace: { type: "project", slug: "other" } }));

    const result = syncReviewInboxIn(place);
    expect(result.cards).toHaveLength(0);
    expect(result.failedImports).toHaveLength(0);
  });

  it("honours decisions recorded before the review inbox existed", () => {
    /*
     * The session-outbox panel wrote its own resolutions file. Without this bridge every
     * entry a person already applied or dismissed would come back as pending the first time
     * the mailbox scanned the folder.
     */
    const place = location();
    write(place, "entry-one.json", meetingEntry());
    const id = syncReviewInboxIn(place).cards[0].id;

    fs.rmSync(place.cards);
    fs.writeFileSync(place.resolutions, JSON.stringify({
      version: 1,
      resolved: [{ entry_id: id, status: "dismissed", resolved_at: "2026-08-14T10:00:00.000Z", reason: "Already recorded." }],
    }));

    const result = syncReviewInboxIn(place);
    expect(result.cards[0]).toMatchObject({
      status: "dismissed",
      reviewed_at: "2026-08-14T10:00:00.000Z",
      result: "Already recorded.",
    });
    expect(countReviewCards(result.cards).pending).toBe(0);
  });

  it("ignores the project proposal envelopes that already share this folder", () => {
    const place = location("project", "example");
    write(place, "20260808163655623-agent-7884b880ccce.json", {
      version: 1,
      id: "agent-7884b880ccce",
      project_slug: "example",
      proposals: [{ id: "p", kind: "memory-note", title: "T", reason: "R", data: { entry: "E" } }],
      resolved: [],
    });

    // A foreign record type in a shared folder is another feature's business, not a failed
    // import to put in front of a person.
    const result = syncReviewInboxIn(place);
    expect(result.cards).toHaveLength(0);
    expect(result.failedImports).toHaveLength(0);
  });

  it("retires a proposal envelope already filed as a failed import", () => {
    const place = location("project", "example");
    const envelope = {
      version: 1,
      id: "agent-7884b880ccce",
      project_slug: "example",
      proposals: [{ id: "p", kind: "memory-note", title: "T", reason: "R", data: { entry: "E" } }],
      resolved: [],
    };
    write(place, "20260808163655623-agent-7884b880ccce.json", envelope);
    // The state a real inbox is already in: earlier versions filed these as broken entries.
    fs.mkdirSync(path.dirname(place.cards), { recursive: true });
    fs.writeFileSync(place.cards, `${JSON.stringify({
      version: 1,
      cards: [{
        // Same key the importer derives from the file name, which is how a real store holds it.
        id: `failed-${hashContent("20260808163655623-agent-7884b880ccce.json").slice(0, 24)}`,
        status: "failed",
        workspace: { type: "project", slug: "example" },
        entry_kind: null,
        source: {
          file_name: "20260808163655623-agent-7884b880ccce.json",
          path: "Mi/inbox/20260808163655623-agent-7884b880ccce.json",
          entry_id: null,
          hash: "b".repeat(64),
          created_at: null,
          session_id: "",
          agent: "",
        },
        visibility: null,
        needs_confirmation: true,
        imported_at: "2026-08-16T02:45:39.681Z",
        failure: { stage: "import", reason: "kind: Invalid input" },
      }],
    }, null, 2)}\n`);

    const result = syncReviewInboxIn(place);
    expect(countReviewCards(result.cards).failed).toBe(0);
    expect(result.cards[0]).toMatchObject({
      status: "dismissed",
      failure: null,
    });
    expect(result.cards[0].result).toContain("Agent Proposal Inbox");
  });
});

describe("review card lifecycle", () => {
  it("keeps the original alongside an edit, and reports which one a confirmation would write", () => {
    const place = location();
    write(place, "entry-one.json", meetingEntry());
    const [card] = syncReviewInboxIn(place).cards;

    const edited = updateReviewCardIn(place, card.id, {
      edited: reviewCardContentSchema.parse({
        title: "Owner walkthrough (corrected)",
        body: "Corrected body.",
        why: "",
        visibility: "internal",
      }),
    });

    expect(edited.original?.title).toBe("Owner walkthrough");
    expect(effectiveContent(edited)?.title).toBe("Owner walkthrough (corrected)");
    expect(edited.status).toBe("pending");
  });

  it("records who reviewed a card, when, and what happened", () => {
    const place = location();
    write(place, "entry-one.json", meetingEntry());
    const [card] = syncReviewInboxIn(place).cards;

    const applied = updateReviewCardIn(place, card.id, {
      status: "applied",
      reviewedAt: "2026-08-16T14:00:00.000Z",
      reviewedBy: "Example User",
      destination: { kind: "lead-notes", record: "lead.yaml", field: "notes" },
      result: "Appended a dated section.",
    });

    expect(applied).toMatchObject({
      status: "applied",
      reviewed_at: "2026-08-16T14:00:00.000Z",
      reviewed_by: "Example User",
      result: "Appended a dated section.",
      destination: { kind: "lead-notes", field: "notes" },
    });
    // A resolved card stays resolved when the folder is scanned again.
    expect(syncReviewInboxIn(place).cards[0].status).toBe("applied");
  });

  it("survives a corrupt card store by rebuilding pending cards from the inbox", () => {
    const place = location();
    write(place, "entry-one.json", meetingEntry());
    syncReviewInboxIn(place);
    fs.writeFileSync(place.cards, "{ corrupt");

    expect(readReviewCardsIn(place)).toEqual([]);
    expect(syncReviewInboxIn(place).cards).toHaveLength(1);
  });
});
