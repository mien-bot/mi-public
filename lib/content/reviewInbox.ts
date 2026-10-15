import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { meetingVisibilitySchema } from "@/lib/schema";
import { hashContent, readCurrentHash, writeFileAtomically } from "./atomicContentWrite";
import {
  listOutboxFiles,
  locateOutbox,
  outboxEntryKindSchema,
  outboxEvidenceSchema,
  outboxMeetingSchema,
  outboxTargetSchema,
  parseOutboxEntry,
  readOutboxResolutionsIn,
  resolveOutboxEntriesIn,
  workspaceKindSchema,
  type OutboxLocation,
  type WorkspaceKind,
  type WorkspaceOutboxEntry,
} from "./workspaceOutbox";

/** Guards the store against unbounded growth if a folder is ever flooded. */
const MAX_CARDS = 2_000;

/**
 * Where a review card stands.
 *
 * `failed` covers two different failures on purpose -- a file Mi could not read, and an
 * application that did not land -- because to the person clearing the mailbox they are the
 * same thing: something that should have arrived and did not. `failure.stage` keeps them
 * distinguishable for the retry path without splitting the status the UI filters on.
 */
export const reviewCardStatusSchema = z.enum(["pending", "applied", "dismissed", "failed", "superseded"]);
export type ReviewCardStatus = z.infer<typeof reviewCardStatusSchema>;

/**
 * The reviewable substance of a card.
 *
 * Stored twice per card: once as `original` (exactly what the agent wrote, never mutated)
 * and once as `edited` (null until a person changes something). Keeping both is what makes
 * "edit before confirming" auditable -- after the fact you can still see what was proposed
 * as opposed to what was approved.
 */
export const reviewCardContentSchema = z.object({
  title: z.string().trim().max(300).default(""),
  body: z.string().max(20_000).default(""),
  why: z.string().max(8_000).default(""),
  visibility: meetingVisibilitySchema,
  meeting: outboxMeetingSchema.nullable().default(null),
  targets: z.array(outboxTargetSchema).max(20).default([]),
  evidence: z.array(outboxEvidenceSchema).max(50).default([]),
});
export type ReviewCardContent = z.infer<typeof reviewCardContentSchema>;

/** Which record (Notes, record field, or a meeting note of its own) a confirmation writes to. */
export const reviewDestinationKindSchema = z.enum([
  "lead-notes",
  "project-notes",
  "qaqc-notes",
  "lead-record-field",
  "project-meeting",
]);
export type ReviewDestinationKind = z.infer<typeof reviewDestinationKindSchema>;

export const reviewDestinationRefSchema = z.object({
  kind: reviewDestinationKindSchema,
  /** The record the write lands in, e.g. "lead.yaml" or "projects/<slug>/memory/notes.md". */
  record: z.string().trim().max(300),
  field: z.string().trim().max(200).default(""),
});
export type ReviewDestinationRef = z.infer<typeof reviewDestinationRefSchema>;

export const reviewCardSchema = z.object({
  /** The entry's content id, or `failed-<hash of file name>` for a file Mi could not read. */
  id: z.string().trim().min(1).max(200),
  status: reviewCardStatusSchema,
  workspace: z.object({
    type: workspaceKindSchema,
    slug: z.string().trim().min(1).max(200),
  }),
  entry_kind: outboxEntryKindSchema.nullable().default(null),
  source: z.object({
    file_name: z.string().trim().max(300),
    /** Workspace-relative (`Mi/inbox/<file>`), so the same card reads the same on both machines. */
    path: z.string().trim().max(600),
    entry_id: z.string().trim().max(200).nullable().default(null),
    /** sha256 of the original file's bytes -- the evidence this card was derived from. */
    hash: z.string().trim().max(64).default(""),
    created_at: z.string().trim().max(60).nullable().default(null),
    session_id: z.string().trim().max(200).default(""),
    agent: z.string().trim().max(100).default(""),
  }),
  visibility: meetingVisibilitySchema.nullable().default(null),
  needs_confirmation: z.boolean().default(true),
  imported_at: z.string().datetime({ offset: true }),
  reviewed_at: z.string().datetime({ offset: true }).nullable().default(null),
  reviewed_by: z.string().trim().max(200).default(""),
  original: reviewCardContentSchema.nullable().default(null),
  edited: reviewCardContentSchema.nullable().default(null),
  destination: reviewDestinationRefSchema.nullable().default(null),
  /** What the application actually did, in the words shown back to the person who confirmed it. */
  result: z.string().trim().max(2_000).default(""),
  failure: z.object({
    stage: z.enum(["import", "application"]),
    reason: z.string().trim().max(2_000),
  }).nullable().default(null),
  /** Set on cards produced by splitting a meeting card. */
  parent_id: z.string().trim().max(200).nullable().default(null),
  superseded_by: z.array(z.string().trim().max(200)).max(50).default([]),
  duplicate_of: z.string().trim().max(200).nullable().default(null),
  /** False until the mailbox has announced this card once. */
  notified: z.boolean().default(false),
});
export type ReviewCard = z.infer<typeof reviewCardSchema>;

const reviewInboxFileSchema = z.object({
  version: z.literal(1),
  cards: z.array(reviewCardSchema).default([]),
});

export interface ReviewInboxLocation extends OutboxLocation {
  /** Mi's own card store, in the record folder rather than the agent-writable workspace. */
  cards: string;
  settings: string;
}

export function reviewInboxLocation(outbox: OutboxLocation, recordDir: string): ReviewInboxLocation {
  return {
    ...outbox,
    cards: path.join(recordDir, ".mi", "review-inbox.json"),
    settings: path.join(recordDir, ".mi", "review-inbox-settings.json"),
  };
}

/**
 * Locates one workspace's review inbox, or null when it has no agent workspace yet.
 *
 * Mirrors `locateOutbox` exactly rather than re-deriving paths, so the mailbox reads the
 * same folder the terminal writes to and a workspace repair cannot quietly point them at
 * two different places.
 */
export function locateReviewInbox(
  kind: WorkspaceKind,
  slug: string,
  options: { create?: boolean } = {},
): ReviewInboxLocation | null {
  const outbox = locateOutbox(kind, slug, options);
  if (!outbox) return null;
  // locateOutbox already resolved the record folder to build `resolutions`; reuse it so the
  // card store cannot drift into a different directory than the resolutions beside it.
  return reviewInboxLocation(outbox, path.dirname(path.dirname(outbox.resolutions)));
}

export function readReviewCardsIn(location: ReviewInboxLocation): ReviewCard[] {
  if (!fs.existsSync(location.cards)) return [];
  try {
    return reviewInboxFileSchema.parse(JSON.parse(fs.readFileSync(location.cards, "utf8"))).cards;
  } catch {
    // A corrupt store must not take the mailbox down. The inbox files are the durable
    // evidence; the next sync rebuilds pending cards from them.
    return [];
  }
}

function writeReviewCardsIn(location: ReviewInboxLocation, cards: ReviewCard[]): void {
  const serialized = `${JSON.stringify(
    reviewInboxFileSchema.parse({ version: 1, cards: cards.slice(0, MAX_CARDS) }),
    null,
    2,
  )}\n`;
  // Derived bookkeeping rebuilt from `Mi/inbox/` on demand -- backing every write up would
  // only accumulate copies in the firm's shared folder.
  writeFileAtomically(location.cards, serialized, {
    expectedHash: readCurrentHash(location.cards),
    backup: false,
  });
}

/** Read-modify-write of the whole store under one atomic write. */
export function mutateReviewCards(
  location: ReviewInboxLocation,
  mutator: (cards: ReviewCard[]) => ReviewCard[],
): ReviewCard[] {
  const next = mutator(readReviewCardsIn(location));
  writeReviewCardsIn(location, next);
  return next;
}

function contentOf(entry: WorkspaceOutboxEntry): ReviewCardContent {
  return reviewCardContentSchema.parse({
    title: entry.title,
    body: entry.body,
    why: entry.why,
    visibility: entry.visibility,
    meeting: entry.meeting,
    targets: entry.targets,
    evidence: entry.evidence,
  });
}

/** The content a confirmation would write: the person's edit when there is one. */
export function effectiveContent(card: ReviewCard): ReviewCardContent | null {
  return card.edited ?? card.original;
}

function failedImportId(fileName: string): string {
  return `failed-${hashContent(fileName).slice(0, 24)}`;
}

/**
 * An envelope written by the project agent proposal inbox (lib/content/agentProposalInbox.ts),
 * which shares this folder. Its `proposals` array and `project_slug` are a shape no workspace
 * outbox entry has, so the two can be told apart without reading either one's contents.
 */
function isAgentProposalEnvelope(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as Record<string, unknown>;
  return typeof value.project_slug === "string" && Array.isArray(value.proposals);
}

export interface ReviewSyncResult {
  cards: ReviewCard[];
  /** Cards created by this pass. Empty on a second pass over unchanged files. */
  imported: ReviewCard[];
  /** Failed-import cards created by this pass. */
  failedImports: ReviewCard[];
  /** Cards whose file was corrected since the last pass. */
  retried: ReviewCard[];
}

/**
 * Imports everything in `Mi/inbox/` that Mi has not seen, and nothing else.
 *
 * Idempotence comes from the id, not from a cursor: a valid entry's id is derived from its
 * content, so the same finding is the same card no matter how many times the folder is
 * scanned, whether Mi restarted, whether Dropbox re-synced the file, or whether the agent
 * workspace was regenerated. Nothing here writes to, edits, or deletes an inbox file --
 * the JSON stays as the evidence the card was built from.
 *
 * A file Mi cannot validate is not dropped. It becomes a `failed` card carrying the file
 * name and the validation message, keyed by file name so that correcting the file in place
 * resolves that same card instead of accumulating a new one per attempt.
 */
export function syncReviewInboxIn(
  location: ReviewInboxLocation,
  options: { now?: () => Date } = {},
): ReviewSyncResult {
  const importedAt = (options.now ?? (() => new Date()))().toISOString();
  const existing = readReviewCardsIn(location);
  const byId = new Map(existing.map((card) => [card.id, card]));
  const imported: ReviewCard[] = [];
  const failedImports: ReviewCard[] = [];
  const retried: ReviewCard[] = [];
  const next = [...existing];

  for (const file of listOutboxFiles(location)) {
    let parsed: ReturnType<typeof parseOutboxEntry>;
    let raw: unknown = null;
    try {
      raw = JSON.parse(file.raw.toString("utf8").replace(/^\uFEFF/, ""));
      parsed = parseOutboxEntry(raw);
    } catch {
      parsed = { ok: false, error: "The file is not valid JSON." };
    }

    // Not every file in this folder is addressed to this mailbox. The project agent proposal
    // inbox writes its own envelopes here too, and reporting one as a broken entry ("kind:
    // Invalid input") accused a perfectly valid file of being corrupt -- and buried it, since
    // a failed card offers nothing to do. Those belong to the project's Agent Proposal Inbox.
    if (!parsed.ok && isAgentProposalEnvelope(raw)) {
      const filed = byId.get(failedImportId(file.fileName));
      if (filed && filed.status === "failed" && filed.failure?.stage === "import") {
        const closed: ReviewCard = {
          ...filed,
          status: "dismissed",
          reviewed_at: importedAt,
          failure: null,
          result: "This file is an agent proposal envelope, reviewed on the project's Agent Proposal Inbox.",
        };
        next[next.indexOf(filed)] = closed;
        byId.set(closed.id, closed);
        retried.push(closed);
      }
      continue;
    }

    if (parsed.ok) {
      const { entry } = parsed;
      // A file addressed to another workspace is another workspace's business. Silently
      // skipping it is right: it is not this mailbox's failure to report.
      if (entry.workspace.type !== location.kind || entry.workspace.slug !== location.slug) continue;

      // The same file may have previously failed validation under its file-name key. Close
      // that card out rather than leaving a stale error beside the entry it became.
      const priorFailure = byId.get(failedImportId(file.fileName));
      if (priorFailure && priorFailure.status === "failed" && priorFailure.failure?.stage === "import") {
        const closed: ReviewCard = {
          ...priorFailure,
          status: "superseded",
          reviewed_at: importedAt,
          superseded_by: [entry.id],
          result: `The file was corrected and imported as ${entry.id}.`,
        };
        next[next.indexOf(priorFailure)] = closed;
        byId.set(closed.id, closed);
        retried.push(closed);
      }

      const known = byId.get(entry.id);
      if (known) {
        // Same finding, seen before. The only thing worth refreshing is where the evidence
        // now lives; status and every review decision on it are untouched.
        if (known.source.file_name !== file.fileName || known.source.hash !== file.hash) {
          const refreshed: ReviewCard = {
            ...known,
            source: {
              ...known.source,
              file_name: file.fileName,
              path: `Mi/inbox/${file.fileName}`,
              hash: file.hash,
            },
          };
          next[next.indexOf(known)] = refreshed;
          byId.set(refreshed.id, refreshed);
        }
        continue;
      }

      const card = reviewCardSchema.parse({
        id: entry.id,
        status: "pending",
        workspace: entry.workspace,
        entry_kind: entry.kind,
        source: {
          file_name: file.fileName,
          path: `Mi/inbox/${file.fileName}`,
          entry_id: entry.id,
          hash: file.hash,
          created_at: entry.created_at,
          session_id: entry.session.id,
          agent: entry.session.agent,
        },
        visibility: entry.visibility,
        needs_confirmation: entry.needs_confirmation,
        imported_at: importedAt,
        original: contentOf(entry),
      });
      next.push(card);
      byId.set(card.id, card);
      imported.push(card);
      continue;
    }

    const id = failedImportId(file.fileName);
    const known = byId.get(id);
    if (known) {
      // Still broken. Refresh the message only when the file itself changed, so a person
      // who edited it can see whether their fix moved the error.
      if (known.source.hash !== file.hash) {
        const refreshed: ReviewCard = {
          ...known,
          status: "failed",
          source: { ...known.source, hash: file.hash },
          failure: { stage: "import", reason: parsed.error },
        };
        next[next.indexOf(known)] = refreshed;
        byId.set(refreshed.id, refreshed);
        retried.push(refreshed);
      }
      continue;
    }

    const card = reviewCardSchema.parse({
      id,
      status: "failed",
      workspace: { type: location.kind, slug: location.slug },
      source: {
        file_name: file.fileName,
        path: `Mi/inbox/${file.fileName}`,
        entry_id: null,
        hash: file.hash,
      },
      imported_at: importedAt,
      failure: { stage: "import", reason: parsed.error },
    });
    next.push(card);
    byId.set(card.id, card);
    failedImports.push(card);
  }

  const reconciled = applyLegacyResolutions(location, next);
  const changed = reconciled.length !== existing.length
    || reconciled.some((card, index) => card !== existing[index]);
  if (changed) writeReviewCardsIn(location, reconciled);

  return { cards: reconciled, imported, failedImports, retried };
}

/**
 * Folds the pre-existing `outbox-resolutions.json` into the card store.
 *
 * The session-outbox panel shipped before this mailbox and recorded applied/dismissed
 * decisions in its own file. Without this bridge, every entry a person already reviewed
 * would reappear as pending the first time the mailbox scanned the folder -- which is
 * exactly the duplicate-work problem the mailbox exists to end.
 */
function applyLegacyResolutions(location: ReviewInboxLocation, cards: ReviewCard[]): ReviewCard[] {
  const legacy = new Map(readOutboxResolutionsIn(location).map((item) => [item.entry_id, item]));
  if (legacy.size === 0) return cards;
  return cards.map((card) => {
    if (card.status !== "pending") return card;
    const resolution = legacy.get(card.id);
    if (!resolution) return card;
    const applied = resolution.status === "applied";
    return {
      ...card,
      status: applied ? "applied" : "dismissed",
      reviewed_at: resolution.resolved_at,
      result: resolution.reason
        || (applied ? "Confirmed from the session-outbox panel before the review inbox existed." : ""),
    } satisfies ReviewCard;
  });
}

/**
 * Mirrors a closing decision into the legacy resolutions file.
 *
 * Two stores would otherwise disagree: the lead overview's session-outbox panel reads
 * resolutions, the mailbox reads cards, and a card applied in one place would still look
 * pending in the other. Failures are swallowed -- the card store is the authority, and a
 * mirror that cannot be written must not roll back a write that already landed.
 */
export function mirrorLegacyResolution(
  location: ReviewInboxLocation,
  entryId: string,
  status: "applied" | "dismissed",
  reason = "",
): void {
  try {
    resolveOutboxEntriesIn(location, { entryIds: [entryId], status, reason });
  } catch {
    // Intentionally ignored; see above.
  }
}

export interface ReviewCardPatch {
  status?: ReviewCardStatus;
  reviewedAt?: string;
  reviewedBy?: string;
  result?: string;
  failure?: ReviewCard["failure"];
  destination?: ReviewDestinationRef | null;
  edited?: ReviewCardContent | null;
  duplicateOf?: string | null;
  supersededBy?: string[];
  notified?: boolean;
}

export function applyCardPatch(card: ReviewCard, patch: ReviewCardPatch): ReviewCard {
  return reviewCardSchema.parse({
    ...card,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.reviewedAt ? { reviewed_at: patch.reviewedAt } : {}),
    ...(patch.reviewedBy !== undefined ? { reviewed_by: patch.reviewedBy } : {}),
    ...(patch.result !== undefined ? { result: patch.result } : {}),
    ...(patch.failure !== undefined ? { failure: patch.failure } : {}),
    ...(patch.destination !== undefined ? { destination: patch.destination } : {}),
    ...(patch.edited !== undefined ? { edited: patch.edited } : {}),
    ...(patch.duplicateOf !== undefined ? { duplicate_of: patch.duplicateOf } : {}),
    ...(patch.supersededBy !== undefined ? { superseded_by: patch.supersededBy } : {}),
    ...(patch.notified !== undefined ? { notified: patch.notified } : {}),
  });
}

export function updateReviewCardIn(
  location: ReviewInboxLocation,
  cardId: string,
  patch: ReviewCardPatch,
): ReviewCard {
  let updated: ReviewCard | null = null;
  mutateReviewCards(location, (cards) => cards.map((card) => {
    if (card.id !== cardId) return card;
    updated = applyCardPatch(card, patch);
    return updated;
  }));
  if (!updated) throw new Error("That review card no longer exists.");
  return updated;
}

export function addReviewCardsIn(location: ReviewInboxLocation, cards: ReviewCard[]): ReviewCard[] {
  return mutateReviewCards(location, (existing) => {
    const known = new Set(existing.map((card) => card.id));
    return [...existing, ...cards.filter((card) => !known.has(card.id))];
  });
}

export function findReviewCard(cards: ReviewCard[], cardId: string): ReviewCard | null {
  return cards.find((card) => card.id === cardId) ?? null;
}

export interface ReviewCounts {
  pending: number;
  failed: number;
  applied: number;
  dismissed: number;
  superseded: number;
}

export function countReviewCards(cards: ReviewCard[]): ReviewCounts {
  const counts: ReviewCounts = { pending: 0, failed: 0, applied: 0, dismissed: 0, superseded: 0 };
  for (const card of cards) counts[card.status] += 1;
  return counts;
}
