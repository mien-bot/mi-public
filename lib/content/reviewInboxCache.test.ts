import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  root: "",
  projectSlugs: ["example-record-35"] as string[],
  syncCalls: [] as { kind: string; slug: string; automate?: boolean }[],
  announceCalls: [] as { cardId: string }[][],
  cards: [] as Record<string, unknown>[],
  automation: "capture-only" as string,
  failingSlugs: [] as string[],
}));

vi.mock("./leads", () => ({ getLeadSlugs: () => [] }));
vi.mock("./permitQaqc", () => ({ getPermitQaqcSlugs: () => [] }));
vi.mock("./projects", () => ({ getProjectSlugs: () => mocks.projectSlugs }));

vi.mock("./reviewInbox", () => ({
  effectiveContent: (card: { content?: { title?: string } }) => card.content,
  locateReviewInbox: (kind: string, slug: string) => ({
    kind,
    slug,
    inbox: path.join(mocks.root, slug, "inbox"),
    cards: path.join(mocks.root, slug, "review-inbox.json"),
    resolutions: path.join(mocks.root, slug, "outbox-resolutions.json"),
    settings: path.join(mocks.root, slug, "review-inbox-settings.json"),
  }),
}));

vi.mock("./reviewInboxService", () => ({
  markAnnounced: (announcements: { cardId: string }[]) => {
    mocks.announceCalls.push(announcements);
  },
  syncWorkspaceReviewInbox: (kind: string, slug: string, options: { automate?: boolean } = {}) => {
    mocks.syncCalls.push({ kind, slug, automate: options.automate });
    if (mocks.failingSlugs.includes(slug)) throw new Error(`"${slug}" is unreachable.`);
    return {
      workspace: { kind, slug, label: `Project ${slug}`, href: `/projects/${slug}` },
      cards: mocks.cards,
      counts: { pending: mocks.cards.length, failed: 0, applied: 0, dismissed: 0, superseded: 0 },
      imported: [],
      failedImports: [],
      autoApplied: [],
      automation: mocks.automation,
    };
  },
}));

const { readCachedReviewInbox, resetReviewInboxCache, whenReviewInboxCacheSettles } = await import(
  "./reviewInboxCache"
);

function card(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "pending",
    notified: false,
    entry_kind: "note",
    content: { title: `Card ${id}` },
    source: { file_name: `${id}.json` },
    ...overrides,
  };
}

/** Lets every queued `setImmediate` in the background pass run to completion. */
async function settle() {
  await whenReviewInboxCacheSettles();
}

beforeEach(() => {
  mocks.root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-review-cache-"));
  fs.mkdirSync(path.join(mocks.root, "example-record-35", "inbox"), { recursive: true });
  mocks.projectSlugs = ["example-record-35"];
  mocks.syncCalls = [];
  mocks.announceCalls = [];
  mocks.cards = [card("a")];
  mocks.automation = "capture-only";
  mocks.failingSlugs = [];
  resetReviewInboxCache();
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(mocks.root, { recursive: true, force: true });
});

describe("readCachedReviewInbox", () => {
  it("answers without scanning, which is what keeps a slow shared folder off the request path", async () => {
    const first = readCachedReviewInbox({ automate: true });

    // The badge starts empty rather than blocking until a scan finishes.
    expect(mocks.syncCalls).toEqual([]);
    expect(first.scannedAt).toBeNull();
    expect(first.counts.pending).toBe(0);

    // Drain the pass this scheduled so it cannot land inside the next case.
    await settle();
  });

  it("serves the counts found by the background pass", async () => {
    readCachedReviewInbox({ automate: true });
    await settle();

    const after = readCachedReviewInbox({ automate: true });
    expect(mocks.syncCalls).toEqual([{ kind: "project", slug: "example-record-35", automate: true }]);
    expect(after.counts.pending).toBe(1);
    expect(after.perWorkspace).toHaveLength(1);
    expect(after.perWorkspace[0]?.workspace.slug).toBe("example-record-35");
    expect(after.scannedAt).not.toBeNull();
  });

  it("does not re-read workspaces whose files have not changed", async () => {
    readCachedReviewInbox({ automate: true });
    await settle();
    expect(mocks.syncCalls).toHaveLength(1);

    // A later poll past the TTL still checks, but an unchanged signature costs no reads.
    vi.setSystemTime(Date.now() + 60_000);
    readCachedReviewInbox({ automate: true });
    await settle();

    expect(mocks.syncCalls).toHaveLength(1);
  });

  it("rescans once a workspace's inbox changes", async () => {
    readCachedReviewInbox({ automate: true });
    await settle();
    expect(mocks.syncCalls).toHaveLength(1);

    fs.writeFileSync(path.join(mocks.root, "example-record-35", "inbox", "new-entry.json"), "{}");
    mocks.cards = [card("a"), card("b")];
    vi.setSystemTime(Date.now() + 60_000);
    readCachedReviewInbox({ automate: true });
    await settle();

    expect(mocks.syncCalls).toHaveLength(2);
    expect(readCachedReviewInbox({ automate: true }).counts.pending).toBe(2);
  });

  it("hands each announcement over exactly once", async () => {
    readCachedReviewInbox({ automate: true });
    await settle();

    const first = readCachedReviewInbox({ automate: true });
    expect(first.announcements.map((a) => a.cardId)).toEqual(["a"]);
    expect(mocks.announceCalls).toHaveLength(1);

    // A second poll must not re-announce the same import, or every window would toast it.
    const second = readCachedReviewInbox({ automate: true });
    expect(second.announcements).toEqual([]);
  });

  it("keeps an announcement a refresh produced before anyone collected the last one", async () => {
    readCachedReviewInbox({ automate: true });
    await settle();

    fs.writeFileSync(path.join(mocks.root, "example-record-35", "inbox", "second.json"), "{}");
    mocks.cards = [card("a"), card("b")];
    vi.setSystemTime(Date.now() + 60_000);
    readCachedReviewInbox({ automate: true });
    await settle();

    // "a" was collected by the poll that scheduled this pass, so only the pass's own
    // findings are still queued. Nothing is dropped and nothing is announced twice.
    const collected = readCachedReviewInbox({ automate: true });
    expect(collected.announcements.map((a) => a.cardId)).toEqual(["a", "b"]);
  });

  it("runs one pass at a time so overlapping polls cannot stack scans", async () => {
    readCachedReviewInbox({ automate: true });
    readCachedReviewInbox({ automate: true });
    readCachedReviewInbox({ automate: true });
    await settle();

    expect(mocks.syncCalls).toHaveLength(1);
  });

  it("skips an unreachable workspace instead of losing the whole badge", async () => {
    fs.mkdirSync(path.join(mocks.root, "unreachable", "inbox"), { recursive: true });
    mocks.projectSlugs = ["unreachable", "example-record-35"];
    mocks.failingSlugs = ["unreachable"];

    readCachedReviewInbox({ automate: true });
    await settle();

    // One offline folder must not hide pending work everywhere else.
    const after = readCachedReviewInbox({ automate: true });
    expect(mocks.syncCalls.map((c) => c.slug)).toEqual(["unreachable", "example-record-35"]);
    expect(after.counts.pending).toBe(1);
    expect(after.perWorkspace.map((entry) => entry.workspace.slug)).toEqual(["example-record-35"]);
  });

  it("skips cards that were already notified", async () => {
    mocks.cards = [card("a", { notified: true })];
    readCachedReviewInbox({ automate: true });
    await settle();

    expect(readCachedReviewInbox({ automate: true }).announcements).toEqual([]);
    expect(mocks.announceCalls).toEqual([]);
  });
});
