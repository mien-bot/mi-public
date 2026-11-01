import type { ReviewCardContent, ReviewDestinationKind } from "./reviewInbox";

const EXCERPT_LIMIT = 160;

const NOISE = [
  /\bhttps?:\/\/\S+/gi,
  /\b[\w.-]*notion\.(?:so|site)\/\S*/gi,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\b[0-9a-f]{32}\b/gi,
  // Paths: anything with a separator, plus drive-letter paths.
  /\b[a-zA-Z]:[\\/]\S*/g,
  /(?:\.{1,2}[\\/])?[\w.-]+(?:[\\/][\w.-]+)+/g,
];

const REMOVED = "\u0000";

function clean(text: string): string {
  let result = text.replace(/^#+\s.*$/gm, " ").replace(/[*_`]/g, "");
  for (const pattern of NOISE) result = result.replace(pattern, REMOVED);
  // A removed link takes the little word that pointed at it, so "saved at <path>" reads "saved".
  for (let pass = 0; pass < 3; pass += 1) {
    result = result
      .replace(/\b(?:at|in|from|to|see|on|of|and|or)\s+\u0000/gi, REMOVED)
      .replace(/\u0000\s*\(\s*\u0000\s*\)/g, REMOVED)
      .replace(/\u0000\s+\u0000/g, REMOVED);
  }
  return result
    .replaceAll(REMOVED, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s|$)/.exec(text);
  return (match?.[0] ?? text).trim();
}

/**
 * One readable sentence for the confirmation list. Display only: nothing here reaches the saved
 * record or a fingerprint, so provenance and evidence stay intact in what is written.
 */
export function reviewExcerpt(content: ReviewCardContent | null, meetingSummary = ""): string {
  if (!content) return "";
  for (const source of [meetingSummary, content.why, content.body]) {
    // Split first: a link's own final period must still end its sentence once the link is gone.
    const raw = firstSentence(source.replace(/^#+\s.*$/gm, " ").replace(/\s+/g, " ").trim());
    const cleaned = clean(raw);
    const sentence = /[.!?]$/.test(raw) && cleaned && !/[.!?]$/.test(cleaned) ? `${cleaned}.` : cleaned;
    if (sentence.replace(/[^\p{L}\p{N}]/gu, "").length < 3) continue;
    if (sentence.length <= EXCERPT_LIMIT) return sentence;
    return `${sentence.slice(0, EXCERPT_LIMIT - 1).replace(/\s+\S*$/, "")}…`;
  }
  return "";
}

const DESTINATION_NAMES: Record<ReviewDestinationKind, string> = {
  "lead-notes": "Lead notes",
  "project-notes": "Project knowledge",
  "qaqc-notes": "Engagement notes",
  "qaqc-memory": "QA/QC knowledge",
  "lead-record-field": "Lead record",
  "project-meeting": "Meetings",
  "workspace-folder": "Chosen folder",
};

export function reviewDestinationName(kind: ReviewDestinationKind): string {
  return DESTINATION_NAMES[kind];
}
