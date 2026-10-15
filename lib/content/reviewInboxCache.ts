import fs from "node:fs";

import { getLeadSlugs } from "./leads";
import { getPermitQaqcSlugs } from "./permitQaqc";
import { getProjectSlugs } from "./projects";
import { effectiveContent, locateReviewInbox, type ReviewCounts } from "./reviewInbox";
import {
  markAnnounced,
  syncWorkspaceReviewInbox,
  type GlobalReviewInbox,
} from "./reviewInboxService";
import type { WorkspaceKind } from "./workspaceOutbox";

/**
 * The badge's read model, kept off the request path.
 *
 * The mailbox badge polls every 20s, and a scan reads one file per card store, per
 * resolution log, and per record in every workspace. On a local disk that is free. On the
 * shared Dropbox folder it is not: content reads there are served by the Windows Cloud
 * Files provider, and when the sync engine is busy every single read costs about two
 * seconds while `stat` and `readdir` stay at well under a millisecond. Scanning inline then
 * blocked Node's only thread for minutes at a time, which queued every other request behind
 * it and left the desktop window with nothing to paint.
 *
 * So the handler never scans. It answers from `snapshot` and, at most once per
 * `REFRESH_TTL_MS`, starts a background pass that yields to the event loop between
 * workspaces. Two things keep that pass cheap: it is single-flight, and it begins with a
 * metadata-only signature so an unchanged mailbox costs a few hundred `stat` calls and zero
 * reads.
 *
 * The trade is that the badge can lag one poll behind. A count that is a few seconds stale
 * is worth far more than a window that never paints.
 */

const REFRESH_TTL_MS = 15_000;

const EMPTY_COUNTS: ReviewCounts = {
  pending: 0,
  failed: 0,
  applied: 0,
  dismissed: 0,
  superseded: 0,
};

const WORKSPACE_KINDS: { kind: WorkspaceKind; slugs: () => string[] }[] = [
  { kind: "lead", slugs: getLeadSlugs },
  { kind: "project", slugs: getProjectSlugs },
  { kind: "permit-qaqc", slugs: getPermitQaqcSlugs },
];

interface Snapshot {
  counts: ReviewCounts;
  perWorkspace: GlobalReviewInbox["perWorkspace"];
  /** Announced once, then dropped: see `readCachedReviewInbox`. */
  announcements: GlobalReviewInbox["announcements"];
  scannedAt: number | null;
  signature: string | null;
}

let snapshot: Snapshot = {
  counts: { ...EMPTY_COUNTS },
  perWorkspace: [],
  announcements: [],
  scannedAt: null,
  signature: null,
};

let inFlight: Promise<void> | null = null;

/** Metadata only. Never opens a file, so it stays cheap on a stalled sync provider. */
function statSignature(target: string): string {
  try {
    const stats = fs.statSync(target);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return "-";
  }
}

/**
 * A workspace's inputs, described without reading any of them.
 *
 * Outbox entries are append-only -- `appendOutboxEntryTo` treats a re-submitted id as a
 * duplicate rather than an update -- so the entry file names capture every change to the
 * inbox and their contents never need hashing.
 */
function workspaceSignature(kind: WorkspaceKind, slug: string): string {
  let location = null;
  try {
    location = locateReviewInbox(kind, slug);
  } catch {
    return `${kind}/${slug}:unreachable`;
  }
  if (!location) return `${kind}/${slug}:none`;
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(location.inbox).sort();
  } catch {
    entries = ["unreadable"];
  }
  return [
    `${kind}/${slug}`,
    entries.join(","),
    statSignature(location.cards),
    statSignature(location.resolutions),
    statSignature(location.settings),
  ].join("|");
}

function currentSignature(): string {
  const parts: string[] = [];
  for (const { kind, slugs } of WORKSPACE_KINDS) {
    let list: string[] = [];
    try {
      list = slugs();
    } catch {
      parts.push(`${kind}:unreachable`);
      continue;
    }
    for (const slug of list) parts.push(workspaceSignature(kind, slug));
  }
  return parts.join("\n");
}

/** Hands the thread back so a queued request is served between workspaces. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function refresh(options: { automate?: boolean }): Promise<void> {
  // Yield before touching the disk. Everything below this line, including the cheap
  // signature pass, must land after the request that scheduled it has been answered.
  await yieldToEventLoop();
  const signature = currentSignature();
  if (snapshot.signature !== null && signature === snapshot.signature) {
    // Nothing moved. Record the check so the TTL restarts without re-reading anything.
    snapshot = { ...snapshot, scannedAt: Date.now() };
    return;
  }

  const counts: ReviewCounts = { ...EMPTY_COUNTS };
  const perWorkspace: GlobalReviewInbox["perWorkspace"] = [];
  const announced: GlobalReviewInbox["announcements"] = [];

  for (const { kind, slugs } of WORKSPACE_KINDS) {
    let list: string[] = [];
    try {
      list = slugs();
    } catch {
      continue;
    }
    for (const slug of list) {
      await yieldToEventLoop();
      let result;
      try {
        result = syncWorkspaceReviewInbox(kind, slug, { automate: options.automate });
      } catch {
        continue;
      }
      if (result.cards.length === 0) continue;
      perWorkspace.push({
        workspace: result.workspace,
        counts: result.counts,
        automation: result.automation,
      });
      for (const key of Object.keys(counts) as (keyof ReviewCounts)[]) {
        counts[key] += result.counts[key];
      }
      for (const card of result.cards) {
        if (card.notified || (card.status !== "pending" && card.status !== "failed")) continue;
        announced.push({
          cardId: card.id,
          workspace: result.workspace,
          kind: card.status === "failed" ? "failed import" : (card.entry_kind ?? "entry"),
          title: effectiveContent(card)?.title || card.source.file_name,
        });
      }
    }
  }

  if (announced.length > 0) markAnnounced(announced);

  snapshot = {
    counts,
    perWorkspace,
    // Anything this pass found is queued behind whatever a reader has not collected yet, so
    // a refresh landing between two polls cannot swallow an announcement.
    announcements: [...snapshot.announcements, ...announced],
    scannedAt: Date.now(),
    // Re-read after the pass: automation and `markAnnounced` both write, so the signature
    // taken before the scan is already out of date and would force a pointless rescan.
    signature: currentSignature(),
  };
}

function scheduleRefresh(options: { automate?: boolean }): void {
  if (inFlight) return;
  if (snapshot.scannedAt !== null && Date.now() - snapshot.scannedAt < REFRESH_TTL_MS) return;
  const pass = refresh(options).catch(() => {
    // A failed pass leaves the previous snapshot in place and retries on the next poll.
  });
  inFlight = pass.finally(() => {
    inFlight = null;
  });
}

export interface CachedReviewInbox {
  counts: ReviewCounts;
  perWorkspace: GlobalReviewInbox["perWorkspace"];
  announcements: GlobalReviewInbox["announcements"];
  /** Null until the first pass lands, which is what the badge renders as "nothing yet". */
  scannedAt: number | null;
}

/**
 * The badge's counts, as of the last completed pass, plus any announcements not yet
 * collected. Returns immediately: the refresh it may start is deliberately not awaited.
 */
export function readCachedReviewInbox(options: { automate?: boolean } = {}): CachedReviewInbox {
  scheduleRefresh(options);
  const announcements = snapshot.announcements;
  // Handing an announcement out is what marks it delivered, so the same import is never
  // announced twice even though the snapshot outlives the request.
  if (announcements.length > 0) snapshot = { ...snapshot, announcements: [] };
  return {
    counts: snapshot.counts,
    perWorkspace: snapshot.perWorkspace,
    announcements,
    scannedAt: snapshot.scannedAt,
  };
}

/** Test seam: drops the snapshot so a case starts from a cold cache. */
export function resetReviewInboxCache(): void {
  snapshot = {
    counts: { ...EMPTY_COUNTS },
    perWorkspace: [],
    announcements: [],
    scannedAt: null,
    signature: null,
  };
  inFlight = null;
}

/** Test seam: waits for an in-flight pass so a case can assert on settled counts. */
export function whenReviewInboxCacheSettles(): Promise<void> {
  return inFlight ?? Promise.resolve();
}
