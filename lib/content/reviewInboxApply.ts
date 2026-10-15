import { meetingNoteSchema, type MeetingNote } from "@/lib/schema";
import { ContentConflictError, hashContent } from "./atomicContentWrite";
import { getLead, getLeadWithHash } from "./leads";
import { updateLead } from "./leadMutations";
import { leadReviewCards } from "./outboxProposals";
import { getPermitQaqcEngagement, getPermitQaqcEngagementWithHash } from "./permitQaqc";
import { updatePermitQaqcEngagement } from "./permitQaqcMutations";
import {
  appendProjectMemoryNote,
  getMeetingNotes,
  getProjectMemory,
  writeMeetingNote,
} from "./projectWorkspace";
import { getProjectSlugs } from "./projects";
import { DEFAULT_TIMEZONE, isValidIanaTimezone } from "./timezone";
import {
  effectiveContent,
  type ReviewCard,
  type ReviewCardContent,
  type ReviewDestinationKind,
  type ReviewDestinationRef,
} from "./reviewInbox";
import { describeMeetingContent, type MeetingCardDetails } from "./reviewMeetingCard";
import type { WorkspaceKind } from "./workspaceOutbox";

const LEAD_NOTES_LIMIT = 20_000;
/** Read off permitQaqcEngagementSchema's own `notes` cap, not shared with the lead one -- two
 * records, two schemas, so a change to either must not silently move the other's ceiling. */
const QAQC_NOTES_LIMIT = 20_000;

/**
 * Who a destination's contents may reach.
 *
 * Every destination Mi writes today is `internal`, and the guard below still exists,
 * because the moment a client-facing export gains a destination the failure mode is
 * silent: an internal entry -- the team's own read on a client's budget -- would land in
 * a document that leaves the firm. Blocking it at the applier means adding that
 * destination cannot forget to.
 */
export type DestinationAudience = "internal" | "client";

export interface ReviewDestinationOption {
  ref: ReviewDestinationRef;
  /** The button's own words, so the action and its effect cannot drift apart. */
  label: string;
  /** Human-readable "record → field", shown in the confirmation preview. */
  record: string;
  audience: DestinationAudience;
  mode: "append" | "replace";
  available: boolean;
  unavailableReason: string;
  /** What the record holds right now. */
  current: string;
  /** Exactly what would be added (append) or written (replace). */
  proposed: string;
}

export function visibilityAllowsDestination(
  visibility: "internal" | "client-visible" | null,
  audience: DestinationAudience,
): boolean {
  return audience === "internal" || visibility === "client-visible";
}

function pad(value: string): string {
  return value.trim();
}

/**
 * The dated section a confirmed card appends.
 *
 * Deliberately self-describing: date, source file, session, agent, visibility, and who
 * confirmed it. A note that cannot say where it came from is indistinguishable a month
 * later from something a person typed, which is exactly the confusion the review inbox
 * exists to prevent. The heading carries the meeting's own date when the entry stated one
 * and the import date when it did not -- never a guess.
 */
export function renderNoteSection(input: {
  card: ReviewCard;
  content: ReviewCardContent;
  details: MeetingCardDetails | null;
  reviewedBy: string;
  confirmedAt: string;
}): { heading: string; body: string } {
  const { card, content, details, reviewedBy, confirmedAt } = input;
  const dateLabel = details?.when.date
    ?? card.source.created_at?.slice(0, 10)
    ?? confirmedAt.slice(0, 10);
  const kindLabel = card.entry_kind === "meeting" ? "Meeting note" : `${card.entry_kind ?? "Entry"} note`;
  const heading = `${kindLabel} — ${dateLabel} — ${content.title}`;

  const lines: string[] = [];
  lines.push(
    `_Imported from the Mi review inbox and confirmed ${confirmedAt.slice(0, 16).replace("T", " ")}`
    + `${reviewedBy ? ` by ${reviewedBy}` : ""}. `
    + `Source: ${card.source.path}${card.source.agent ? ` (${card.source.agent}` : ""}`
    + `${card.source.agent && card.source.session_id ? ` session ${card.source.session_id}` : ""}`
    + `${card.source.agent ? ")" : ""}. `
    + `Visibility: ${content.visibility}._`,
  );

  if (details) {
    const timing = [details.when.date, [details.when.startTime, details.when.endTime].filter(Boolean).join("–"), details.when.timezone]
      .filter(Boolean).join(" · ");
    if (timing) lines.push("", `**When:** ${timing}`);
    else if (details.when.stated) lines.push("", `**When (as stated):** ${details.when.stated}`);
    if (details.attendees.length) lines.push("", `**Attendees:** ${details.attendees.join(", ")}`);
    if (details.summary) lines.push("", details.summary);
    if (details.decisions.length) {
      lines.push("", "**Decisions**", ...details.decisions.map((item) => `- ${item}`));
    }
    if (details.actionItems.length) {
      lines.push("", "**Action items**", ...details.actionItems.map((item) => {
        const suffix = [item.owner && `owner ${item.owner}`, item.dueDate && `due ${item.dueDate}`]
          .filter(Boolean).join(", ");
        return `- ${item.description}${suffix ? ` (${suffix})` : ""}`;
      }));
    }
    if (details.openQuestions.length) {
      lines.push("", "**Open questions**", ...details.openQuestions.map((item) => `- ${item}`));
    }
    if (details.risks.length) {
      lines.push("", "**Risks**", ...details.risks.map((item) => `- ${item}`));
    }
    if (details.remainder) lines.push("", details.remainder);
  } else {
    if (content.body) lines.push("", content.body);
  }

  if (content.why) lines.push("", `**Why it was recorded:** ${content.why}`);
  const evidence = content.evidence.map((item) => item.path ?? item.quote).filter(Boolean);
  if (evidence.length) lines.push("", "**Evidence**", ...evidence.map((item) => `- ${item}`));

  return { heading, body: pad(lines.join("\n")) };
}

function meetingDetailsFor(card: ReviewCard, content: ReviewCardContent): MeetingCardDetails | null {
  if (card.entry_kind !== "meeting") return null;
  return describeMeetingContent(content, card.source.created_at);
}

/**
 * `meeting_type` when the entry never named one. A meeting record has to carry a type, and
 * guessing "Client Meeting" from a title would put a fact in the record that nobody stated.
 */
const MEETING_TYPE_NOT_STATED = "Not stated";

function meetingRecordId(cardId: string): string {
  const slug = cardId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[a-z0-9]/.test(slug) ? slug.slice(0, 80) : `review-${slug}`.slice(0, 80);
}

/**
 * A clock time in the `HH:MM` shape a meeting record stores, or "" when the entry's timing
 * cannot be read as one. Reading "2:00 pm" as 14:00 is arithmetic on what the entry already
 * said; anything less definite is left blank, and the entry's own wording survives verbatim
 * in `raw_notes` either way.
 */
export function meetingClockTime(value: string): string {
  const match = /^\s*(\d{1,2}):([0-5]\d)\s*([ap])\.?m\.?\s*$/i.exec(value)
    ?? /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(value);
  if (!match) return "";
  let hour = Number(match[1]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return "";
    if (meridiem === "p" && hour !== 12) hour += 12;
    if (meridiem === "a" && hour === 12) hour = 0;
  }
  if (hour > 23) return "";
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

/**
 * The meeting record a card would file, or null when the entry cannot become one.
 *
 * A meeting note is stored and read back by its date, so a date is not an optional
 * nicety here. The entry's own words are the only source for it -- resolving "last Tuesday"
 * against the reviewer's clock would file a meeting on a day nobody said it happened, which
 * is the one thing this pipeline must never do. Everything the meeting schema has no field
 * for (risks, provenance, whatever the agent wrote under its own headings) is preserved
 * verbatim in `raw_notes` rather than dropped.
 *
 * A value the record schema still refuses returns null too, rather than throwing mid-apply:
 * the destination reports itself unavailable instead of failing after the reviewer clicks.
 */
export function meetingRecordFor(input: {
  card: ReviewCard;
  content: ReviewCardContent;
  details: MeetingCardDetails;
  rawNotes: string;
}): MeetingNote | null {
  if (!input.details.when.date) return null;
  try {
    return buildMeetingRecord(input);
  } catch {
    return null;
  }
}

function buildMeetingRecord({ card, content, details, rawNotes }: {
  card: ReviewCard;
  content: ReviewCardContent;
  details: MeetingCardDetails;
  rawNotes: string;
}): MeetingNote {
  const timezone = isValidIanaTimezone(details.when.timezone)
    ? details.when.timezone
    : process.env.MI_TIMEZONE && isValidIanaTimezone(process.env.MI_TIMEZONE)
      ? process.env.MI_TIMEZONE
      : DEFAULT_TIMEZONE;
  return meetingNoteSchema.parse({
    id: meetingRecordId(card.id),
    // The record caps a title at 200 characters where an entry allows 300; the full text is
    // still in the note body this record carries as raw notes.
    title: content.title.slice(0, 200),
    meeting_type: MEETING_TYPE_NOT_STATED,
    visibility: content.visibility,
    meeting_status: "completed",
    date: details.when.date,
    start_time: meetingClockTime(details.when.startTime),
    end_time: meetingClockTime(details.when.endTime),
    timezone,
    attendees: details.attendees,
    summary: details.summary,
    decisions: details.decisions,
    // A due date the record cannot store as YYYY-MM-DD stays inside the description, where
    // "due end of next week" is still readable, instead of being silently discarded.
    action_items: details.actionItems.map((item) => {
      const storedDate = /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ? item.dueDate : "";
      const description = storedDate || !item.dueDate
        ? item.description
        : `${item.description} (due ${item.dueDate})`;
      return { description, owner: item.owner, due_date: storedDate };
    }),
    open_questions: details.openQuestions,
    raw_notes: rawNotes,
  });
}

function projectMeetingOption(
  projectSlug: string,
  card: ReviewCard,
  content: ReviewCardContent,
  details: MeetingCardDetails,
  rawNotes: string,
): ReviewDestinationOption {
  const known = getProjectSlugs().includes(projectSlug);
  const meeting = known ? meetingRecordFor({ card, content, details, rawNotes }) : null;
  const filed = known ? getMeetingNotes(projectSlug) : [];
  const duplicate = Boolean(meeting)
    && filed.some((existing) => existing.id === meeting?.id && existing.date === meeting?.date);
  const file = meeting
    ? `projects/${projectSlug}/meetings/${meeting.date}-${meeting.id}.md`
    : `projects/${projectSlug}/meetings/`;
  return {
    ref: { kind: "project-meeting", record: file, field: "" },
    label: "Confirm and save as a Meeting",
    record: `${file} → new meeting note`,
    audience: "internal",
    mode: "append",
    available: Boolean(meeting) && !duplicate,
    unavailableReason: !known
      ? `Project "${projectSlug}" does not exist locally.`
      : !details.when.date
        ? "The entry never stated an absolute meeting date, and Mi will not date a meeting for you."
          + " Edit this card to add the date, or add the meeting on the project's Meetings page."
        : !meeting
          ? "Mi could not build a valid meeting record from this entry. Edit the card, or add the meeting on the project's Meetings page."
          : duplicate
            ? "This entry was already filed as a meeting note on that date."
            : "",
    current: known ? `${filed.length} existing meeting note(s)` : "",
    proposed: meeting
      ? [
        `${meeting.date}${[meeting.start_time, meeting.end_time].filter(Boolean).join("–")
          ? ` ${[meeting.start_time, meeting.end_time].filter(Boolean).join("–")}` : ""} ${meeting.timezone}`,
        `Title: ${meeting.title}`,
        `Type: ${meeting.meeting_type}`,
        meeting.attendees.length ? `Attendees: ${meeting.attendees.join(", ")}` : "",
        meeting.summary ? `Summary: ${meeting.summary}` : "",
        meeting.decisions.length ? `Decisions: ${meeting.decisions.length}` : "",
        meeting.action_items.length ? `Action items: ${meeting.action_items.length}` : "",
        meeting.open_questions.length ? `Open questions: ${meeting.open_questions.length}` : "",
      ].filter(Boolean).join("\n")
      : "",
  };
}

function leadRecordFieldOption(
  slug: string,
  card: ReviewCard,
  content: ReviewCardContent,
): ReviewDestinationOption | null {
  if (content.targets.length === 0) return null;
  let lead;
  try {
    lead = getLead(slug).lead;
  } catch {
    return null;
  }
  // Reuses the existing proposal validator rather than re-deriving which lead fields are
  // writable -- one allowlist, one coercion path, one place to change.
  const proposal = leadReviewCards([{
    id: card.id,
    version: 1,
    kind: card.entry_kind ?? "record-change",
    created_at: card.source.created_at ?? new Date().toISOString(),
    session: { id: card.source.session_id || "unknown", agent: card.source.agent || "unknown" },
    workspace: { type: "lead", slug },
    visibility: content.visibility,
    title: content.title,
    body: content.body || content.title,
    why: content.why,
    evidence: content.evidence,
    targets: content.targets,
    needs_confirmation: card.needs_confirmation,
    meeting: content.meeting,
  }], lead)[0];

  const fields = proposal.changes.map((change) => change.field).join(", ");
  return {
    ref: { kind: "lead-record-field", record: "lead.yaml", field: fields },
    label: "Confirm and update the lead record",
    record: `lead.yaml → ${fields || content.targets.map((target) => target.field).join(", ")}`,
    audience: "internal",
    mode: "replace",
    available: Boolean(proposal.patch),
    unavailableReason: proposal.unappliableReason ?? "",
    current: proposal.changes.map((change) => `${change.field}: ${change.current}`).join("\n"),
    proposed: proposal.changes.map((change) => `${change.field}: ${change.proposed}`).join("\n"),
  };
}

/**
 * A record's own free-text Notes field, as an append-only destination.
 *
 * A lead and a permit QAQC engagement differ only in which file holds the field and in what
 * a reviewer should do once it fills up. One builder is what keeps "append a dated section"
 * from quietly meaning two different things on two records.
 */
function notesDestination(input: {
  destinationKind: ReviewDestinationKind;
  record: string;
  label: string;
  limit: number;
  overflowReason: string;
  read: () => string;
  addition: string;
}): ReviewDestinationOption {
  let current = "";
  let available = true;
  let unavailableReason = "";
  try {
    current = input.read();
  } catch (cause) {
    available = false;
    unavailableReason = cause instanceof Error ? cause.message : `${input.record} could not be read.`;
  }
  if (available && current.length + input.addition.length + 2 > input.limit) {
    available = false;
    unavailableReason = input.overflowReason;
  }
  return {
    ref: { kind: input.destinationKind, record: input.record, field: "notes" },
    label: input.label,
    record: `${input.record} → notes`,
    audience: "internal",
    mode: "append",
    available,
    unavailableReason,
    current,
    proposed: input.addition,
  };
}

/**
 * Every place this card could be confirmed to, with the exact before/after for each.
 *
 * Unavailable destinations are returned rather than hidden. "Mi cannot write this" is
 * information a reviewer needs -- an action that silently is not offered reads as a bug in
 * the card.
 */
export function describeDestinations(
  kind: WorkspaceKind,
  slug: string,
  card: ReviewCard,
): ReviewDestinationOption[] {
  const content = effectiveContent(card);
  if (!content) return [];
  const details = meetingDetailsFor(card, content);
  const section = renderNoteSection({
    card,
    content,
    details,
    reviewedBy: "",
    confirmedAt: new Date().toISOString(),
  });
  const options: ReviewDestinationOption[] = [];
  const addition = `## ${section.heading}\n\n${section.body}`;

  if (kind === "lead") {
    options.push(notesDestination({
      destinationKind: "lead-notes",
      record: "lead.yaml",
      label: "Confirm and add to Lead Notes",
      limit: LEAD_NOTES_LIMIT,
      overflowReason: "Lead notes would exceed the 20,000-character limit."
        + " Move older notes to the meeting log first.",
      read: () => getLead(slug).lead.notes ?? "",
      addition,
    }));
  }

  // A permit QAQC engagement has no phases, no memory folder and no meetings -- qaqc.yaml is
  // the record, so its Notes field is where a confirmed finding lands. Without this branch
  // every permit-qaqc card fell through to the "no destination" placeholder below and could
  // only be dismissed, which is not a review outcome.
  if (kind === "permit-qaqc") {
    options.push(notesDestination({
      destinationKind: "qaqc-notes",
      record: "qaqc.yaml",
      label: "Confirm and add to Engagement Notes",
      limit: QAQC_NOTES_LIMIT,
      overflowReason: "Engagement notes would exceed the 20,000-character limit."
        + " Move older notes into the round they belong to first.",
      read: () => getPermitQaqcEngagement(slug).engagement.notes ?? "",
      addition,
    }));
  }

  const projectSlug = kind === "project"
    ? slug
    : kind === "lead"
      ? safeConvertedProjectSlug(slug)
      : null;
  // A meeting entry's own home is a meeting note, so that destination is offered first --
  // appending it to Project Notes is the fallback, not the answer.
  if (projectSlug && details) {
    options.push(projectMeetingOption(projectSlug, card, content, details, section.body));
  }

  if (projectSlug) {
    const known = getProjectSlugs().includes(projectSlug);
    const memory = known ? getProjectMemory(projectSlug) : null;
    options.push({
      ref: {
        kind: "project-notes",
        record: `projects/${projectSlug}/memory/notes.md`,
        field: section.heading,
      },
      label: "Save as project knowledge",
      record: `projects/${projectSlug}/memory/notes.md → new section`,
      audience: "internal",
      mode: "append",
      available: known,
      unavailableReason: known ? "" : `Project "${projectSlug}" does not exist locally.`,
      current: memory
        ? `${memory.sections.length} existing section(s)${memory.lastUpdated ? `, updated ${memory.lastUpdated}` : ""}`
        : "No project notes file yet — it will be created.",
      proposed: `## ${section.heading}\n\n${section.body}`,
    });
  }

  if (kind === "lead") {
    const recordOption = leadRecordFieldOption(slug, card, content);
    if (recordOption) options.push(recordOption);
  }

  // Unreachable for the three workspace kinds that exist today, and kept precisely so a
  // fourth one cannot repeat the permit-qaqc bug: a card with no branch at all showed a
  // reviewer buttons that did nothing rather than saying why.
  if (options.length === 0) {
    options.push({
      ref: { kind: "project-notes", record: "", field: "" },
      label: "No destination",
      record: "—",
      audience: "internal",
      mode: "append",
      available: false,
      unavailableReason: `Mi does not yet write ${kind} records from a review card. Dismiss it to clear it.`,
      current: "",
      proposed: "",
    });
  }

  return options;
}

function safeConvertedProjectSlug(leadSlug: string): string | null {
  try {
    return getLead(leadSlug).lead.converted_project_slug;
  } catch {
    return null;
  }
}

export class ReviewApplyError extends Error {}

export interface ReviewApplyOutcome {
  result: string;
  record: string;
}

/**
 * Performs the write a confirmed card described, and nothing else.
 *
 * Notes destinations append; they never rewrite what is already there. The lead path goes
 * through `updateLead` behind the same optimistic hash check the edit form uses, so a
 * confirmation racing another machine's edit fails loudly instead of overwriting it.
 */
export function applyReviewCardToDestination(input: {
  kind: WorkspaceKind;
  slug: string;
  card: ReviewCard;
  destinationKind: ReviewDestinationKind;
  reviewedBy: string;
  now?: () => Date;
}): ReviewApplyOutcome {
  const { kind, slug, card, destinationKind, reviewedBy } = input;
  const content = effectiveContent(card);
  if (!content) throw new ReviewApplyError("This card has no content to apply.");

  const option = describeDestinations(kind, slug, card)
    .find((candidate) => candidate.ref.kind === destinationKind);
  if (!option) throw new ReviewApplyError("That destination is not available for this card.");
  if (!option.available) throw new ReviewApplyError(option.unavailableReason || "That destination is not available.");
  if (!visibilityAllowsDestination(content.visibility, option.audience)) {
    throw new ReviewApplyError("An internal entry cannot be written to a client-facing destination.");
  }

  const confirmedAt = (input.now ?? (() => new Date()))().toISOString();
  const details = meetingDetailsFor(card, content);
  const section = renderNoteSection({ card, content, details, reviewedBy, confirmedAt });

  if (destinationKind === "lead-notes") {
    const current = getLeadWithHash(slug);
    const existing = current.lead.notes ?? "";
    const next = [existing.trimEnd(), `## ${section.heading}\n\n${section.body}`]
      .filter(Boolean).join("\n\n");
    if (next.length > LEAD_NOTES_LIMIT) {
      throw new ReviewApplyError("Lead notes would exceed the 20,000-character limit.");
    }
    updateLead(slug, { ...current.lead, notes: next }, { expectedHash: current.hash });
    return {
      result: `Appended “${section.heading}” to Lead Notes. ${existing.length} existing character(s) preserved.`,
      record: "lead.yaml → notes",
    };
  }

  if (destinationKind === "qaqc-notes") {
    if (kind !== "permit-qaqc") {
      throw new ReviewApplyError("Engagement notes only exist on a permit QAQC engagement.");
    }
    const current = getPermitQaqcEngagementWithHash(slug);
    const existing = current.engagement.notes ?? "";
    const next = [existing.trimEnd(), `## ${section.heading}\n\n${section.body}`]
      .filter(Boolean).join("\n\n");
    if (next.length > QAQC_NOTES_LIMIT) {
      throw new ReviewApplyError("Engagement notes would exceed the 20,000-character limit.");
    }
    // Same optimistic hash check the engagement edit form uses, for the same reason: two
    // partners on the same Dropbox folder confirming at once must collide loudly, not
    // overwrite each other's note.
    updatePermitQaqcEngagement(slug, { ...current.engagement, notes: next }, { expectedHash: current.hash });
    return {
      result: `Appended “${section.heading}” to Engagement Notes. ${existing.length} existing character(s) preserved.`,
      record: "qaqc.yaml → notes",
    };
  }

  if (destinationKind === "project-meeting") {
    const projectSlug = kind === "project" ? slug : safeConvertedProjectSlug(slug);
    if (!projectSlug) throw new ReviewApplyError("This lead is not linked to a project yet.");
    if (!details) throw new ReviewApplyError("Only a meeting entry can be filed as a meeting note.");
    const meeting = meetingRecordFor({ card, content, details, rawNotes: section.body });
    if (!meeting) {
      throw new ReviewApplyError(details.when.date
        ? "Mi could not build a valid meeting record from this entry."
        : "The entry never stated an absolute meeting date, so Mi cannot file it.");
    }
    try {
      writeMeetingNote(projectSlug, meeting);
    } catch (cause) {
      if (cause instanceof ContentConflictError) {
        throw new ReviewApplyError("A meeting note for this entry and date already exists.");
      }
      throw cause;
    }
    return {
      result: `Filed “${meeting.title}” as a meeting note dated ${meeting.date}.`,
      record: `projects/${projectSlug}/meetings/${meeting.date}-${meeting.id}.md`,
    };
  }

  if (destinationKind === "project-notes") {
    const projectSlug = kind === "project" ? slug : safeConvertedProjectSlug(slug);
    if (!projectSlug) throw new ReviewApplyError("This lead is not linked to a project yet.");
    appendProjectMemoryNote(projectSlug, { title: section.heading, entry: section.body });
    return {
      result: `Appended “${section.heading}” to projects/${projectSlug}/memory/notes.md.`,
      record: `projects/${projectSlug}/memory/notes.md`,
    };
  }

  if (kind !== "lead") throw new ReviewApplyError("Record-field changes are only applied on leads today.");
  const current = getLeadWithHash(slug);
  const proposal = leadReviewCards([{
    id: card.id,
    version: 1,
    kind: card.entry_kind ?? "record-change",
    created_at: card.source.created_at ?? confirmedAt,
    session: { id: card.source.session_id || "unknown", agent: card.source.agent || "unknown" },
    workspace: { type: "lead", slug },
    visibility: content.visibility,
    title: content.title,
    body: content.body || content.title,
    why: content.why,
    evidence: content.evidence,
    targets: content.targets,
    needs_confirmation: card.needs_confirmation,
    meeting: content.meeting,
  }], current.lead)[0];
  if (!proposal?.patch) {
    throw new ReviewApplyError(proposal?.unappliableReason ?? "This card proposes no applicable record change.");
  }
  updateLead(slug, { ...current.lead, ...proposal.patch }, { expectedHash: current.hash });
  return {
    result: `Updated ${proposal.changes.map((change) => `${change.field} → ${change.proposed}`).join(", ")}.`,
    record: "lead.yaml",
  };
}

export interface BulkApplyPlan {
  fingerprint: string;
  allowed: boolean;
  blockers: string[];
  /** One line per card: what would change where. */
  effects: { cardId: string; title: string; record: string; summary: string; proposed: string }[];
}

/**
 * Whether a set of cards may be confirmed in one action, and what the combined effect is.
 *
 * Bulk confirmation is the one place where "I read them all" is usually a lie, so the bar
 * is deliberately narrow: one workspace, every card pending, every card with a live
 * destination, and no two cards fighting over the same record field. Anything else is
 * refused with the reason, rather than partially applied.
 */
export function planBulkApply(input: {
  kind: WorkspaceKind;
  slug: string;
  cards: ReviewCard[];
  destinationKind: ReviewDestinationKind;
}): BulkApplyPlan {
  const { kind, slug, cards, destinationKind } = input;
  const blockers: string[] = [];
  const effects: BulkApplyPlan["effects"] = [];

  if (cards.length === 0) blockers.push("No cards were selected.");
  const workspaces = new Set(cards.map((card) => `${card.workspace.type}/${card.workspace.slug}`));
  if (workspaces.size > 1) {
    blockers.push("Selected cards belong to more than one workspace. Confirm each workspace separately.");
  }
  const notPending = cards.filter((card) => card.status !== "pending");
  if (notPending.length > 0) {
    blockers.push(`${notPending.length} selected card(s) are no longer pending.`);
  }

  const fieldClaims = new Map<string, string>();
  for (const card of cards) {
    const content = effectiveContent(card);
    const option = describeDestinations(kind, slug, card)
      .find((candidate) => candidate.ref.kind === destinationKind);
    if (!option) {
      blockers.push(`“${content?.title ?? card.id}” cannot be sent to that destination.`);
      continue;
    }
    if (!option.available) {
      blockers.push(`“${content?.title ?? card.id}”: ${option.unavailableReason}`);
      continue;
    }
    if (!visibilityAllowsDestination(content?.visibility ?? null, option.audience)) {
      blockers.push(`“${content?.title ?? card.id}” is internal and that destination is client-facing.`);
      continue;
    }
    if (option.mode === "replace") {
      for (const target of content?.targets ?? []) {
        const key = `${target.record}.${target.field}`;
        const claimed = fieldClaims.get(key);
        if (claimed !== undefined && claimed !== target.proposed) {
          blockers.push(`Two selected cards propose different values for ${key}.`);
        }
        fieldClaims.set(key, target.proposed);
      }
    }
    effects.push({
      cardId: card.id,
      title: content?.title ?? card.id,
      record: option.record,
      proposed: option.proposed,
      summary: option.mode === "append"
        ? `Appends a dated section (${option.proposed.length} characters).`
        : option.proposed,
    });
  }

  const fingerprint = hashContent(JSON.stringify({ kind, slug, destinationKind,
    cards: cards.map(card => ({ id: card.id, status: card.status, content: effectiveContent(card), source: card.source })),
  }));
  return { fingerprint, allowed: blockers.length === 0 && effects.length === cards.length, blockers, effects };
}
