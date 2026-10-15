import fs from "node:fs";
import path from "node:path";
import { hashContent } from "./atomicContentWrite";
import { getLead, getLeadSlugs } from "./leads";
import { getPermitQaqcEngagement, getPermitQaqcSlugs } from "./permitQaqc";
import { getProject, getProjectSlugs } from "./projects";
import {
  addReviewCardsIn,
  countReviewCards,
  effectiveContent,
  findReviewCard,
  locateReviewInbox,
  mirrorLegacyResolution,
  readReviewCardsIn,
  reviewCardContentSchema,
  reviewCardSchema,
  syncReviewInboxIn,
  updateReviewCardIn,
  type ReviewCard,
  type ReviewCardContent,
  type ReviewCounts,
  type ReviewDestinationKind,
  type ReviewInboxLocation,
} from "./reviewInbox";
import {
  applyReviewCardToDestination,
  describeDestinations,
  planBulkApply,
  ReviewApplyError,
  type BulkApplyPlan,
  type ReviewDestinationOption,
} from "./reviewInboxApply";
import {
  automationAllows,
  readReviewInboxSettings,
  requiresHumanConfirmation,
  type ReviewAutomationMode,
} from "./reviewInboxSettings";
import {
  describeMeetingCard,
  describeMeetingTiming,
  planMeetingSplit,
  type MeetingCardDetails,
} from "./reviewMeetingCard";
import { parseOutboxEntry, type WorkspaceKind } from "./workspaceOutbox";

export interface ReviewWorkspaceRef {
  kind: WorkspaceKind;
  slug: string;
  label: string;
  href: string;
}

function workspaceLabel(kind: WorkspaceKind, slug: string): string {
  try {
    if (kind === "lead") return getLead(slug).lead.name;
    if (kind === "project") return getProject(slug).meta.name;
    return getPermitQaqcEngagement(slug).engagement.name;
  } catch {
    return slug;
  }
}

function workspaceHref(kind: WorkspaceKind, slug: string): string {
  if (kind === "lead") return `/leads/${slug}`;
  if (kind === "project") return `/projects/${slug}`;
  return `/permit-qaqc/${slug}`;
}

export function reviewWorkspaceRef(kind: WorkspaceKind, slug: string): ReviewWorkspaceRef {
  return { kind, slug, label: workspaceLabel(kind, slug), href: workspaceHref(kind, slug) };
}

/**
 * Every workspace whose inbox the mailbox watches.
 *
 * A record whose store is briefly unreachable (Dropbox mid-sync) is skipped rather than
 * failing the whole mailbox -- one offline folder must not hide pending work everywhere
 * else.
 */
export function listReviewWorkspaces(): ReviewWorkspaceRef[] {
  const refs: ReviewWorkspaceRef[] = [];
  const kinds: { kind: WorkspaceKind; slugs: () => string[] }[] = [
    { kind: "lead", slugs: getLeadSlugs },
    { kind: "project", slugs: getProjectSlugs },
    { kind: "permit-qaqc", slugs: getPermitQaqcSlugs },
  ];
  for (const { kind, slugs } of kinds) {
    let list: string[] = [];
    try {
      list = slugs();
    } catch {
      continue;
    }
    for (const slug of list) refs.push(reviewWorkspaceRef(kind, slug));
  }
  return refs;
}

export interface WorkspaceSyncResult {
  workspace: ReviewWorkspaceRef;
  cards: ReviewCard[];
  counts: ReviewCounts;
  imported: ReviewCard[];
  failedImports: ReviewCard[];
  autoApplied: ReviewCard[];
  automation: ReviewAutomationMode;
}

const EMPTY_COUNTS: ReviewCounts = { pending: 0, failed: 0, applied: 0, dismissed: 0, superseded: 0 };

/**
 * Scans one workspace's `Mi/inbox/` and brings its cards up to date.
 *
 * `automate` is off for anything that renders a page: importing is Mi's own bookkeeping and
 * safe to do on a read, but writing to a lead or a project during a page render would make
 * a refresh a mutation. The route handlers that own the automation pass it explicitly.
 */
export function syncWorkspaceReviewInbox(
  kind: WorkspaceKind,
  slug: string,
  options: { automate?: boolean; now?: () => Date } = {},
): WorkspaceSyncResult {
  const workspace = reviewWorkspaceRef(kind, slug);
  let location: ReviewInboxLocation | null = null;
  try {
    location = locateReviewInbox(kind, slug);
  } catch {
    location = null;
  }
  if (!location) {
    return {
      workspace,
      cards: [],
      counts: EMPTY_COUNTS,
      imported: [],
      failedImports: [],
      autoApplied: [],
      automation: "capture-only",
    };
  }

  const sync = syncReviewInboxIn(location, { now: options.now });
  const automation = readReviewInboxSettings(location).automation;
  const autoApplied: ReviewCard[] = [];

  if (options.automate && automation !== "capture-only") {
    for (const card of sync.imported) {
      if (!automationAllows(card, automation)) continue;
      const destination = describeDestinations(kind, slug, card).find((option) => option.available);
      if (!destination) continue;
      try {
        const outcome = applyReviewCardToDestination({
          kind,
          slug,
          card,
          destinationKind: destination.ref.kind,
          reviewedBy: "Mi (workspace automation)",
          now: options.now,
        });
        autoApplied.push(updateReviewCardIn(location, card.id, {
          status: "applied",
          reviewedAt: (options.now ?? (() => new Date()))().toISOString(),
          reviewedBy: "Mi (workspace automation)",
          destination: destination.ref,
          result: outcome.result,
          failure: null,
        }));
        mirrorLegacyResolution(location, card.id, "applied");
      } catch (cause) {
        updateReviewCardIn(location, card.id, {
          status: "failed",
          failure: {
            stage: "application",
            reason: cause instanceof Error ? cause.message : "The automatic apply did not complete.",
          },
        });
      }
    }
  }

  const cards = readReviewCardsIn(location);
  return {
    workspace,
    cards,
    counts: countReviewCards(cards),
    imported: sync.imported,
    failedImports: sync.failedImports,
    autoApplied,
    automation,
  };
}

/** The card plus everything a reviewer needs to decide, computed server-side once. */
export interface ReviewCardView {
  card: ReviewCard;
  workspace: ReviewWorkspaceRef;
  content: ReviewCardContent | null;
  meeting: MeetingCardDetails | null;
  /** Rendered server-side so the client bundle never has to import a filesystem module. */
  timing: string | null;
  destinations: ReviewDestinationOption[];
  confirmation: { required: boolean; reason: string };
  /** The child cards a split would create. Empty for non-meeting cards. */
  splitPreview: { kind: string; title: string }[];
}

export function buildReviewCardView(
  kind: WorkspaceKind,
  slug: string,
  card: ReviewCard,
  options: { withDestinations?: boolean } = {},
): ReviewCardView {
  const meeting = describeMeetingCard(card);
  return {
    card,
    workspace: reviewWorkspaceRef(kind, slug),
    content: effectiveContent(card),
    meeting,
    timing: meeting ? describeMeetingTiming(meeting) : null,
    destinations: options.withDestinations === false ? [] : safeDestinations(kind, slug, card),
    confirmation: requiresHumanConfirmation(card),
    splitPreview: meeting
      ? planMeetingSplit(meeting).map((part) => ({ kind: part.kind, title: part.title }))
      : [],
  };
}

function safeDestinations(kind: WorkspaceKind, slug: string, card: ReviewCard): ReviewDestinationOption[] {
  try {
    return describeDestinations(kind, slug, card);
  } catch {
    return [];
  }
}

export interface GlobalReviewInbox {
  unavailable: ReviewWorkspaceRef[];
  views: ReviewCardView[];
  counts: ReviewCounts;
  perWorkspace: { workspace: ReviewWorkspaceRef; counts: ReviewCounts; automation: ReviewAutomationMode }[];
  /** Cards imported by this pass that have not been announced yet. */
  announcements: { cardId: string; workspace: ReviewWorkspaceRef; kind: string; title: string }[];
}

/**
 * The whole mailbox, across every workspace.
 *
 * Resolved cards are kept (the mailbox has a history tab) but only pending and failed ones
 * drive the badge -- a count that includes things already dealt with is a count nobody
 * trusts.
 */
export function readGlobalReviewInbox(options: {
  automate?: boolean;
  withDestinations?: boolean;
  now?: () => Date;
} = {}): GlobalReviewInbox {
  const views: ReviewCardView[] = [];
  const unavailable: ReviewWorkspaceRef[] = [];
  const perWorkspace: GlobalReviewInbox["perWorkspace"] = [];
  const announcements: GlobalReviewInbox["announcements"] = [];
  const counts: ReviewCounts = { ...EMPTY_COUNTS };

  for (const ref of listReviewWorkspaces()) {
    let result: WorkspaceSyncResult;
    try {
      result = syncWorkspaceReviewInbox(ref.kind, ref.slug, {
        automate: options.automate,
        now: options.now,
      });
    } catch {
      unavailable.push(ref);
      continue;
    }
    if (result.cards.length === 0) continue;

    perWorkspace.push({ workspace: result.workspace, counts: result.counts, automation: result.automation });
    for (const key of Object.keys(counts) as (keyof ReviewCounts)[]) counts[key] += result.counts[key];
    for (const card of result.cards) {
      views.push(buildReviewCardView(ref.kind, ref.slug, card, {
        withDestinations: options.withDestinations,
      }));
    }
    for (const card of result.cards) {
      if (card.notified || (card.status !== "pending" && card.status !== "failed")) continue;
      announcements.push({
        cardId: card.id,
        workspace: result.workspace,
        kind: card.status === "failed" ? "failed import" : (card.entry_kind ?? "entry"),
        title: effectiveContent(card)?.title || card.source.file_name,
      });
    }
  }

  return { views, counts, perWorkspace, announcements, unavailable };
}

/** Marks announced cards so the same import is never announced twice. */
export function markAnnounced(announcements: GlobalReviewInbox["announcements"]): void {
  const byWorkspace = new Map<string, { ref: ReviewWorkspaceRef; ids: string[] }>();
  for (const announcement of announcements) {
    const key = `${announcement.workspace.kind}/${announcement.workspace.slug}`;
    const bucket = byWorkspace.get(key) ?? { ref: announcement.workspace, ids: [] };
    bucket.ids.push(announcement.cardId);
    byWorkspace.set(key, bucket);
  }
  for (const { ref, ids } of byWorkspace.values()) {
    try {
      const location = locateReviewInbox(ref.kind, ref.slug);
      if (!location) continue;
      const marked = new Set(ids);
      // One write per workspace rather than one per card.
      const cards = readReviewCardsIn(location);
      if (!cards.some((card) => marked.has(card.id) && !card.notified)) continue;
      for (const id of ids) updateReviewCardIn(location, id, { notified: true });
    } catch {
      // A workspace that cannot record the announcement will simply announce again.
    }
  }
}

export interface WorkspaceReviewSummary {
  workspace: ReviewWorkspaceRef;
  counts: ReviewCounts;
  /** Newest pending cards first, for the lead/project panel. */
  pending: ReviewCardView[];
  meetingPendingCount: number;
  automation: ReviewAutomationMode;
}

function pendingSortKey(card: ReviewCard): string {
  return `${card.source.created_at ?? card.imported_at}`;
}

/**
 * The per-record panel's data: counts plus the newest pending cards.
 *
 * Destinations are computed here because the panel offers Confirm directly -- a panel that
 * shows a count but makes you navigate to act on it is the same invisible-queue problem one
 * page further along.
 */
export function readWorkspaceReviewSummary(
  kind: WorkspaceKind,
  slug: string,
  options: { limit?: number } = {},
): WorkspaceReviewSummary {
  let result: WorkspaceSyncResult;
  try {
    result = syncWorkspaceReviewInbox(kind, slug);
  } catch {
    return {
      workspace: reviewWorkspaceRef(kind, slug),
      counts: EMPTY_COUNTS,
      pending: [],
      meetingPendingCount: 0,
      automation: "capture-only",
    };
  }

  const pending = result.cards
    .filter((card) => card.status === "pending")
    .sort((left, right) => pendingSortKey(right).localeCompare(pendingSortKey(left)))
    // Ten rather than three: the panel now offers bulk confirmation, and a limit that cuts
    // a terminal session's batch of eight in half sends people to the mailbox for exactly
    // the trip this panel exists to save. Anything past ten still links through.
    .slice(0, options.limit ?? 10)
    .map((card) => buildReviewCardView(kind, slug, card));

  return {
    workspace: result.workspace,
    counts: result.counts,
    pending,
    meetingPendingCount: result.cards
      .filter((card) => card.status === "pending" && card.entry_kind === "meeting").length,
    automation: result.automation,
  };
}

export class ReviewActionError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

function requireLocation(kind: WorkspaceKind, slug: string): ReviewInboxLocation {
  const location = locateReviewInbox(kind, slug, { create: true });
  if (!location) throw new ReviewActionError("This workspace has no agent inbox yet.", 404);
  return location;
}

function requirePending(location: ReviewInboxLocation, cardId: string): ReviewCard {
  const card = findReviewCard(readReviewCardsIn(location), cardId);
  if (!card) throw new ReviewActionError("That review card no longer exists.", 404);
  if (card.status !== "pending") {
    throw new ReviewActionError(`That card is already ${card.status}; refresh to see its current state.`, 409);
  }
  return card;
}

export interface ReviewActionResult {
  card: ReviewCard;
  message: string;
  warning?: string;
  /** Present only when a record was actually written. Never set by an import. */
  applied: { record: string; result: string } | null;
}

export function confirmReviewCard(input: {
  kind: WorkspaceKind;
  slug: string;
  cardId: string;
  destinationKind: ReviewDestinationKind;
  reviewedBy: string;
  now?: () => Date;
}): ReviewActionResult {
  const location = requireLocation(input.kind, input.slug);
  const card = requirePending(location, input.cardId);
  const at = (input.now ?? (() => new Date()))().toISOString();

  let applied: ReviewActionResult["applied"] = null;
  try {
    const outcome = applyReviewCardToDestination({
      kind: input.kind,
      slug: input.slug,
      card,
      destinationKind: input.destinationKind,
      reviewedBy: input.reviewedBy,
      now: input.now,
    });
    applied = outcome;
    const updated = updateReviewCardIn(location, card.id, {
      status: "applied",
      reviewedAt: at,
      reviewedBy: input.reviewedBy,
      destination: describeDestinations(input.kind, input.slug, card)
        .find((option) => option.ref.kind === input.destinationKind)?.ref ?? null,
      result: outcome.result,
      failure: null,
    });
    mirrorLegacyResolution(location, card.id, "applied");
    return { card: updated, message: outcome.result, applied: outcome };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "The card could not be applied.";
    if (applied) {
      // The destination write has already succeeded. A receipt failure is not a
      // failed apply: reporting it that way invites the person to duplicate it.
      const message = `${applied.result} The record was saved, but its review receipt could not be completed: ${reason}. Check the saved record before applying this card again.`;
      return {
        card: { ...card, status: "applied", reviewed_at: at, reviewed_by: input.reviewedBy, result: message, failure: null },
        message,
        warning: message,
        applied,
      };
    }
    const failed = updateReviewCardIn(location, card.id, {
      status: "failed",
      reviewedAt: at,
      reviewedBy: input.reviewedBy,
      failure: { stage: "application", reason },
    });
    // The record was not written, so this is reported as a failure rather than as an apply.
    if (cause instanceof ReviewApplyError) return { card: failed, message: reason, applied: null };
    throw new ReviewActionError(reason, 409);
  }
}

export function dismissReviewCard(input: {
  kind: WorkspaceKind;
  slug: string;
  cardId: string;
  reviewedBy: string;
  reason?: string;
  now?: () => Date;
}): ReviewActionResult {
  const location = requireLocation(input.kind, input.slug);
  const card = findReviewCard(readReviewCardsIn(location), input.cardId);
  if (!card) throw new ReviewActionError("That review card no longer exists.", 404);
  const at = (input.now ?? (() => new Date()))().toISOString();
  const updated = updateReviewCardIn(location, card.id, {
    status: "dismissed",
    reviewedAt: at,
    reviewedBy: input.reviewedBy,
    result: input.reason ?? "",
    failure: null,
  });
  mirrorLegacyResolution(location, card.id, "dismissed", input.reason ?? "");
  return { card: updated, message: "Dismissed. No record was changed.", applied: null };
}

export function markReviewCardDuplicate(input: {
  kind: WorkspaceKind;
  slug: string;
  cardId: string;
  duplicateOf?: string;
  reviewedBy: string;
  now?: () => Date;
}): ReviewActionResult {
  const location = requireLocation(input.kind, input.slug);
  const card = findReviewCard(readReviewCardsIn(location), input.cardId);
  if (!card) throw new ReviewActionError("That review card no longer exists.", 404);
  const at = (input.now ?? (() => new Date()))().toISOString();
  const updated = updateReviewCardIn(location, card.id, {
    status: "superseded",
    reviewedAt: at,
    reviewedBy: input.reviewedBy,
    duplicateOf: input.duplicateOf ?? null,
    result: input.duplicateOf
      ? `Marked as a duplicate of ${input.duplicateOf}.`
      : "Marked as a duplicate.",
  });
  mirrorLegacyResolution(location, card.id, "dismissed", "Marked as a duplicate.");
  return { card: updated, message: "Marked as a duplicate. No record was changed.", applied: null };
}

export function editReviewCard(input: {
  kind: WorkspaceKind;
  slug: string;
  cardId: string;
  content: unknown;
}): ReviewActionResult {
  const location = requireLocation(input.kind, input.slug);
  const card = requirePending(location, input.cardId);
  const parsed = reviewCardContentSchema.safeParse(input.content);
  if (!parsed.success) {
    throw new ReviewActionError(parsed.error.issues[0]?.message ?? "The edited card is not valid.");
  }
  // The original stays exactly as the agent wrote it; an edit is a second copy, never a
  // rewrite of the evidence.
  const updated = updateReviewCardIn(location, card.id, { edited: parsed.data });
  return { card: updated, message: "Edit saved. The card is still pending your confirmation.", applied: null };
}

export function splitReviewCard(input: {
  kind: WorkspaceKind;
  slug: string;
  cardId: string;
  reviewedBy: string;
  now?: () => Date;
}): ReviewActionResult & { children: ReviewCard[] } {
  const location = requireLocation(input.kind, input.slug);
  const card = requirePending(location, input.cardId);
  const details = describeMeetingCard(card);
  if (!details) throw new ReviewActionError("Only a meeting card can be split.");
  const parts = planMeetingSplit(details);
  if (parts.length < 2) {
    throw new ReviewActionError("This meeting has no decisions, actions, risks, or questions to split out.");
  }

  const at = (input.now ?? (() => new Date()))().toISOString();
  const content = effectiveContent(card);
  const children = parts.map((part) => reviewCardSchema.parse({
    id: `${card.id}-${part.kind}-${hashContent(part.body).slice(0, 10)}`,
    status: "pending",
    workspace: card.workspace,
    entry_kind: part.kind,
    source: card.source,
    visibility: card.visibility,
    needs_confirmation: card.needs_confirmation,
    imported_at: at,
    parent_id: card.id,
    original: reviewCardContentSchema.parse({
      title: part.title,
      body: part.body,
      why: content?.why ?? "",
      visibility: content?.visibility ?? "internal",
      meeting: part.kind === "meeting" ? content?.meeting ?? null : null,
      targets: part.kind === "meeting" ? content?.targets ?? [] : [],
      evidence: content?.evidence ?? [],
    }),
  }));

  addReviewCardsIn(location, children);
  const updated = updateReviewCardIn(location, card.id, {
    status: "superseded",
    reviewedAt: at,
    reviewedBy: input.reviewedBy,
    supersededBy: children.map((child) => child.id),
    result: `Split into ${children.length} cards. No record was changed.`,
  });
  mirrorLegacyResolution(location, card.id, "dismissed", "Split into separate cards.");
  return {
    card: updated,
    children,
    message: `Split into ${children.length} cards. Each one still needs its own confirmation.`,
    applied: null,
  };
}

/**
 * Re-reads a failed card's source file, or reopens a card whose application failed.
 *
 * An import failure is retried against the file on disk, so correcting the JSON and
 * pressing Retry is the whole recovery path. An application failure just returns the card
 * to pending -- nothing was written, so there is nothing to undo first.
 */
export function retryReviewCard(input: {
  kind: WorkspaceKind;
  slug: string;
  cardId: string;
  now?: () => Date;
}): ReviewActionResult {
  const location = requireLocation(input.kind, input.slug);
  const card = findReviewCard(readReviewCardsIn(location), input.cardId);
  if (!card) throw new ReviewActionError("That review card no longer exists.", 404);
  if (card.status !== "failed") throw new ReviewActionError("Only a failed card can be retried.", 409);

  if (card.failure?.stage === "application") {
    const reopened = updateReviewCardIn(location, card.id, {
      status: "pending",
      failure: null,
      result: "",
    });
    return { card: reopened, message: "Card reopened. Nothing was written when it failed.", applied: null };
  }

  const filePath = path.join(location.inbox, card.source.file_name);
  if (!fs.existsSync(filePath)) {
    throw new ReviewActionError(`${card.source.file_name} is no longer in the inbox folder.`, 404);
  }
  let parsed;
  try {
    parsed = parseOutboxEntry(JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")));
  } catch {
    parsed = { ok: false as const, error: "The file is not valid JSON." };
  }
  if (!parsed.ok) {
    const still = updateReviewCardIn(location, card.id, {
      failure: { stage: "import", reason: parsed.error },
    });
    return { card: still, message: `Still invalid: ${parsed.error}`, applied: null };
  }

  // The corrected file imports on the next scan under its own content id; this card closes
  // out pointing at it, so the failure stays in the history instead of vanishing.
  const sync = syncReviewInboxIn(location, { now: input.now });
  const imported = sync.cards.find((item) => item.id === parsed.entry.id);
  return {
    card: findReviewCard(sync.cards, card.id) ?? card,
    message: imported
      ? `${card.source.file_name} now validates and was imported as a pending card.`
      : `${card.source.file_name} now validates.`,
    applied: null,
  };
}

export function previewBulkApply(input: {
  kind: WorkspaceKind;
  slug: string;
  cardIds: string[];
  destinationKind: ReviewDestinationKind;
}): BulkApplyPlan {
  const location = requireLocation(input.kind, input.slug);
  const cards = readReviewCardsIn(location);
  const selected = input.cardIds
    .map((id) => findReviewCard(cards, id))
    .filter((card): card is ReviewCard => card !== null);
  if (selected.length !== input.cardIds.length || new Set(input.cardIds).size !== input.cardIds.length) {
    throw new ReviewActionError("The selection contains missing or repeated cards. Refresh and select again.");
  }
  return planBulkApply({
    kind: input.kind,
    slug: input.slug,
    cards: selected,
    destinationKind: input.destinationKind,
  });
}

export function confirmBulkReviewCards(input: {
  kind: WorkspaceKind;
  slug: string;
  cardIds: string[];
  destinationKind: ReviewDestinationKind;
  reviewedBy: string;
  previewFingerprint: string;
  now?: () => Date;
}): { applied: ReviewActionResult[]; plan: BulkApplyPlan } {
  const plan = previewBulkApply(input);
  if (!input.previewFingerprint || input.previewFingerprint !== plan.fingerprint) {
    throw new ReviewActionError("Selected knowledge changed since the preview. Review the selected items again.");
  }
  if (!plan.allowed) {
    throw new ReviewActionError(plan.blockers[0] ?? "These cards cannot be confirmed together.");
  }
  // Sequential on purpose: each apply re-reads the record and re-checks its hash, so a
  // record changing partway through stops the run instead of writing over the change.
  const applied: ReviewActionResult[] = [];
  for (const cardId of input.cardIds) {
    applied.push(confirmReviewCard({ ...input, cardId }));
  }
  return { applied, plan };
}
