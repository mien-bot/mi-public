import {
  meetingSourceSchema,
  type AiMeetingResponse,
  type MeetingNote,
  type MeetingSource,
} from "@/lib/schema";
import type { ExtractedDocument } from "./documentText";

function sourceId(label: string, sha256: string): string {
  return `src-${sha256.slice(0, 12)}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "source"}`;
}

/**
 * Describes an attached source for the meeting record.
 *
 * The hash is of the original bytes, so the record attests the file itself rather than
 * whatever text Mi managed to read out of it. `characters` is the extracted length, which
 * is what makes a silently-empty extraction visible instead of looking like an empty file.
 */
export function describeSource(input: {
  extracted: ExtractedDocument;
  label: string;
  relativePath: string | null;
  capturedAt: string;
}): MeetingSource {
  return meetingSourceSchema.parse({
    id: sourceId(input.label, input.extracted.sha256),
    kind: input.relativePath ? "file" : "paste",
    label: input.label,
    relative_path: input.relativePath,
    captured_at: input.capturedAt,
    sha256: input.extracted.sha256,
    characters: input.extracted.characters,
  });
}

/** Attaching the same file twice replaces its descriptor rather than duplicating it. */
export function attachSource(meeting: MeetingNote, source: MeetingSource): MeetingNote {
  return {
    ...meeting,
    sources: [...meeting.sources.filter((existing) => existing.sha256 !== source.sha256), source],
  };
}

function union(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of lists.flat()) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }
  return merged;
}

/**
 * Folds an extraction into a meeting record without losing what was already there.
 *
 * Additive on purpose. Extraction is a convenience and summaries drop things -- on this
 * lead a condensed summary silently lost six agreed contract terms the transcript
 * contained -- so a second pass over a longer source can only add decisions, questions,
 * actions, and impacts. Nothing already recorded is removed, and `raw_notes` is appended
 * to rather than replaced.
 *
 * It also re-establishes meetingNoteSchema's mirror invariants, because a model may return
 * a decision record or a blocking question whose text never made it into the plain lists.
 */
export function reconcileExtraction(meeting: MeetingNote, extracted: AiMeetingResponse): MeetingNote {
  const decisions = union(
    meeting.decisions,
    extracted.decisions,
    extracted.decision_records.map((record) => record.statement),
  );
  const openQuestions = union(
    meeting.open_questions,
    extracted.open_questions,
    extracted.blocking_questions,
  );
  const blocking = union(meeting.blocking_questions, extracted.blocking_questions)
    .filter((question) => openQuestions.includes(question));

  const knownActions = new Set(meeting.action_items.map((item) => `${item.description}|${item.owner}`));
  const knownImpacts = new Set(meeting.impacts.map((impact) => `${impact.area}|${impact.summary}`));
  const knownDecisions = new Set(meeting.decision_records.map((record) => record.statement));

  return {
    ...meeting,
    summary: meeting.summary || extracted.summary,
    decisions,
    open_questions: openQuestions,
    blocking_questions: blocking,
    decision_records: [
      ...meeting.decision_records,
      ...extracted.decision_records.filter(
        (record) => !knownDecisions.has(record.statement) && decisions.includes(record.statement),
      ),
    ],
    action_items: [
      ...meeting.action_items,
      ...extracted.action_items.filter((item) => !knownActions.has(`${item.description}|${item.owner}`)),
    ],
    impacts: [
      ...meeting.impacts,
      ...extracted.impacts.filter((impact) => !knownImpacts.has(`${impact.area}|${impact.summary}`)),
    ],
  };
}

/**
 * Appends a source's text to the record's raw notes.
 *
 * Kept separate from `reconcileExtraction` because it is the part that must never be
 * lossy: the extraction can be re-run, but the transcript is the evidence, and a record
 * that keeps only the summary cannot be audited against what was actually said.
 */
export function appendRawSourceText(meeting: MeetingNote, source: MeetingSource, text: string): MeetingNote {
  if (!text.trim()) return meeting;
  const header = `--- ${source.label} (${source.kind === "file" ? source.relative_path : "pasted"}) ---`;
  if (meeting.raw_notes.includes(header)) return meeting;
  return {
    ...meeting,
    raw_notes: [meeting.raw_notes.trim(), header, text.trim()].filter(Boolean).join("\n\n"),
  };
}
