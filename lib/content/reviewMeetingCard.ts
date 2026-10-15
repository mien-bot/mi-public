import type { MeetingVisibility } from "@/lib/schema";
import type { ReviewCard, ReviewCardContent } from "./reviewInbox";
import { effectiveContent } from "./reviewInbox";

/**
 * When the meeting happened, as the entry stated it.
 *
 * `date` is populated only from an actual `YYYY-MM-DD`. Anything else the entry said about
 * timing is kept verbatim in `stated` and rendered as a quote, because "last Tuesday" read
 * three weeks later is worse than useless -- and resolving it against the session's own
 * clock would be Mi inventing a meeting date, which is the one thing a review card must
 * never do.
 */
export interface MeetingWhen {
  date: string | null;
  startTime: string;
  endTime: string;
  timezone: string;
  stated: string;
}

export interface MeetingActionItem {
  description: string;
  owner: string;
  dueDate: string;
}

export interface MeetingCardDetails {
  title: string;
  when: MeetingWhen;
  /** The session's own timestamp, shown when the entry never stated a meeting time. */
  recordedAt: string | null;
  attendees: string[];
  summary: string;
  decisions: string[];
  actionItems: MeetingActionItem[];
  openQuestions: string[];
  risks: string[];
  evidence: { path: string | null; quote: string }[];
  visibility: MeetingVisibility;
  /** Body text no heading claimed. Always rendered; nothing an agent wrote is dropped. */
  remainder: string;
}

type Bucket = "summary" | "decisions" | "actions" | "questions" | "risks" | "attendees" | "when";

const HEADINGS: { bucket: Bucket; names: string[] }[] = [
  { bucket: "summary", names: ["summary", "notes", "discussion", "what happened", "overview", "minutes"] },
  { bucket: "decisions", names: ["decisions", "decided", "agreements", "agreed", "outcomes"] },
  {
    bucket: "actions",
    names: ["action items", "actions", "next steps", "to do", "todo", "todos", "follow ups", "follow-ups"],
  },
  { bucket: "questions", names: ["open questions", "questions", "unresolved", "to confirm"] },
  { bucket: "risks", names: ["risks", "concerns", "issues", "blockers", "watch items"] },
  { bucket: "attendees", names: ["attendees", "present", "participants", "attending", "who"] },
  { bucket: "when", names: ["date", "when", "meeting date", "date and time", "time"] },
];

function normalizeHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

function bucketFor(heading: string): Bucket | null {
  const normalized = normalizeHeading(heading);
  return HEADINGS.find((entry) => entry.names.includes(normalized))?.bucket ?? null;
}

/**
 * Recognizes the three heading shapes agents actually write: a markdown heading, a bolded
 * line, and a bare `Label:` line. An inline `Label: value` counts too, so a one-line
 * `Attendees: Casey, Alex` is read the same as a section.
 */
function readHeading(line: string): { heading: string; inline: string } | null {
  const markdown = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(line);
  if (markdown) return { heading: markdown[1].replace(/:$/, ""), inline: "" };
  const bold = /^\s{0,3}\*\*(.+?)\*\*\s*:?\s*(.*)$/.exec(line);
  if (bold) return { heading: bold[1].replace(/:$/, ""), inline: bold[2].trim() };
  const bare = /^\s{0,3}([A-Za-z][A-Za-z &/-]{1,40})\s*:\s*(.*)$/.exec(line);
  if (bare) return { heading: bare[1], inline: bare[2].trim() };
  return null;
}

function isListItem(line: string): boolean {
  return /^\s*(?:[-*•]|\d+[.)])\s+/.test(line);
}

function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/^\[[ xX]\]\s*/, "").trim();
}

function toLines(block: string): string[] {
  const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const items = lines.filter(isListItem).map(stripListMarker).filter(Boolean);
  if (items.length > 0) return items;
  // A prose block under a list heading is still one item -- better one slightly long entry
  // than a decision silently absent from the card.
  return lines.filter((line) => !/^none( recorded)?\.?$/i.test(line));
}

function splitPeople(value: string): string[] {
  return value
    .split(/[,;\n]|\s+and\s+/i)
    .map((item) => stripListMarker(item).replace(/\.$/, "").trim())
    .filter(Boolean);
}

/**
 * Pulls an owner and a due date out of one action line without ever discarding text.
 *
 * Only explicit markers are honoured (`— name`, `owner:`, `due …`). Guessing an owner from
 * a capitalized word would attribute someone else's task to a real person, so anything
 * unrecognized simply stays in the description.
 */
export function parseActionItem(line: string): MeetingActionItem {
  let description = stripListMarker(line);
  let owner = "";
  let dueDate = "";

  const parenthesized = /\((?:due|by)[:\s]+([^)]+)\)/i.exec(description);
  if (parenthesized) {
    dueDate = parenthesized[1].trim();
    description = description.replace(parenthesized[0], " ").trim();
  } else {
    const trailing = /(?:^|[\s,;—-])due(?:\s+date)?[:\s]+([^,;()]+)$/i.exec(description);
    if (trailing) {
      dueDate = trailing[1].trim();
      description = description.slice(0, trailing.index).trim();
    }
  }

  const labelled = /\((?:owner|by)[:\s]+([^)]+)\)|(?:^|[\s,;])owner[:\s]+([^,;()]+)/i.exec(description);
  if (labelled) {
    owner = (labelled[1] ?? labelled[2] ?? "").trim();
    description = description.replace(labelled[0], " ").trim();
  } else {
    const dashed = /\s+[—–]\s+([^—–]+)$/.exec(description);
    if (dashed && dashed[1].trim().split(/\s+/).length <= 4) {
      owner = dashed[1].trim();
      description = description.slice(0, dashed.index).trim();
    }
  }

  return {
    description: description.replace(/[\s,;:—–-]+$/, "").trim() || stripListMarker(line),
    owner,
    dueDate,
  };
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function monthIndex(word: string): number {
  const name = word.toLowerCase().replace(/\.$/, "");
  if (name.length < 3) return -1;
  return MONTH_NAMES.findIndex((month) => month === name || (name.length <= 4 && month.startsWith(name)));
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects the days a month does not have (February 30th) rather than rolling them forward.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Every absolute date the text actually wrote, normalized.
 *
 * Written-out months count: "August 16, 2026" is a date the entry stated, not one Mi worked
 * out, and refusing to read it only pushes the person into retyping it. All-numeric forms
 * (`8/16/26`) are deliberately left out -- day-first and month-first readings of the same
 * string are both plausible, and a meeting filed under the wrong day is worse than one Mi
 * declines to date.
 */
export function statedAbsoluteDates(text: string): string[] {
  const found = new Set<string>();
  const add = (value: string | null) => {
    if (value) found.add(value);
  };
  for (const match of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    add(isoDate(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  for (const match of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const month = monthIndex(match[1]);
    if (month >= 0) add(isoDate(Number(match[3]), month + 1, Number(match[2])));
  }
  for (const match of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g)) {
    const month = monthIndex(match[2]);
    if (month >= 0) add(isoDate(Number(match[3]), month + 1, Number(match[1])));
  }
  return [...found];
}

function parseWhen(value: string): MeetingWhen {
  const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(value)?.[1] ?? null;
  // The am/pm suffix needs its own word boundary: without it, "14:00-15:30 America/Chicago"
  // parsed the "Am" of America as a meridiem and produced "15:30 Am".
  const times = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?:\s?[ap]m\b)?/gi) ?? [];
  const timezone = /\b((?:[A-Z][a-z]+)\/(?:[A-Za-z_+-]+))\b/.exec(value)?.[1]
    ?? /\b(UTC|GMT|[CEMP][SD]T)\b/.exec(value)?.[1]
    ?? "";
  return {
    date,
    startTime: times[0]?.trim() ?? "",
    endTime: times[1]?.trim() ?? "",
    timezone,
    stated: value.trim(),
  };
}

interface ParsedBody {
  buckets: Record<Bucket, string>;
  remainder: string;
}

function parseBody(body: string): ParsedBody {
  const buckets: Record<Bucket, string> = {
    summary: "", decisions: "", actions: "", questions: "", risks: "", attendees: "", when: "",
  };
  const remainder: string[] = [];
  let current: Bucket | null = null;

  for (const line of body.split(/\r?\n/)) {
    // A list item is content even when it looks like `Label: value`, so headings are only
    // considered on non-list lines.
    const heading = isListItem(line) ? null : readHeading(line);
    const bucket = heading ? bucketFor(heading.heading) : null;
    if (heading && bucket) {
      current = bucket;
      if (heading.inline) buckets[bucket] += `${heading.inline}\n`;
      continue;
    }
    if (heading && !isListItem(line) && /^\s{0,3}#{1,6}\s+/.test(line)) {
      // An unrecognized markdown heading ends the previous section rather than absorbing
      // its own content into it.
      current = null;
      remainder.push(line.trim());
      continue;
    }
    if (current) buckets[current] += `${line}\n`;
    else if (line.trim()) remainder.push(line.trim());
  }

  return { buckets, remainder: remainder.join("\n").trim() };
}

/**
 * Builds the meeting view of a card.
 *
 * Structured `meeting` fields win where present; anything the agent left empty is recovered
 * from the body's own headings. The result is the same card shape either way, so a plain
 * `title`/`body` entry -- the only shape the published contract requires -- still shows
 * decisions, actions, questions, and risks in their own sections.
 */
export function describeMeetingCard(card: ReviewCard): MeetingCardDetails | null {
  if (card.entry_kind !== "meeting") return null;
  const content = effectiveContent(card);
  if (!content) return null;
  return describeMeetingContent(content, card.source.created_at);
}

export function describeMeetingContent(
  content: ReviewCardContent,
  recordedAt: string | null,
): MeetingCardDetails {
  const parsed = parseBody(content.body);
  const structured = content.meeting;

  const statedWhen = [structured?.date, structured?.start_time && `${structured.start_time}${structured.end_time ? `–${structured.end_time}` : ""}`, structured?.timezone]
    .filter(Boolean).join(" ")
    || parsed.buckets.when;
  const when = structured?.date
    ? {
      date: structured.date,
      startTime: structured.start_time,
      endTime: structured.end_time,
      timezone: structured.timezone,
      stated: statedWhen.trim(),
    }
    : parseWhen(statedWhen);

  // Agents routinely write the date into the prose ("The August 16, 2026 meeting was...")
  // instead of under a Date: heading. That is still a date the entry stated, so it counts --
  // but only when the entry names exactly one. Two dates in an entry (a meeting and a
  // deadline it discussed) cannot be told apart from here, and picking one would be a guess.
  if (!when.date) {
    const candidates = statedAbsoluteDates(`${content.title}\n${content.body}`);
    if (candidates.length === 1) {
      when.date = candidates[0];
      if (!when.stated) when.stated = candidates[0];
    }
  }

  const summary = structured?.summary?.trim()
    || parsed.buckets.summary.trim()
    // No `Summary` heading at all: the body is the summary. Falling back to the whole body
    // is what keeps a one-paragraph entry from rendering as an empty card.
    || (parsed.remainder && !parsed.buckets.decisions && !parsed.buckets.actions ? parsed.remainder : "");

  return {
    title: content.title,
    when,
    recordedAt,
    attendees: structured?.attendees?.length ? structured.attendees : splitPeople(parsed.buckets.attendees),
    summary,
    decisions: structured?.decisions?.length ? structured.decisions : toLines(parsed.buckets.decisions),
    actionItems: structured?.action_items?.length
      ? structured.action_items.map((item) => ({
        description: item.description,
        owner: item.owner,
        dueDate: item.due_date,
      }))
      : toLines(parsed.buckets.actions).map(parseActionItem),
    openQuestions: structured?.open_questions?.length
      ? structured.open_questions
      : toLines(parsed.buckets.questions),
    risks: structured?.risks?.length ? structured.risks : toLines(parsed.buckets.risks),
    evidence: content.evidence.map((item) => ({ path: item.path, quote: item.quote })),
    visibility: content.visibility,
    remainder: summary === parsed.remainder ? "" : parsed.remainder,
  };
}

/** One line for a list row: the absolute time when stated, and plainly not when it wasn't. */
export function describeMeetingTiming(details: MeetingCardDetails): string {
  if (details.when.date) {
    const window = [details.when.startTime, details.when.endTime].filter(Boolean).join("–");
    return [details.when.date, window, details.when.timezone].filter(Boolean).join(" · ");
  }
  if (details.when.stated) return `Stated as “${details.when.stated}” — no absolute date given`;
  return details.recordedAt
    ? `No meeting date stated — recorded ${details.recordedAt.slice(0, 16).replace("T", " ")}`
    : "No meeting date stated";
}

/**
 * The child cards a split would create, in the order they are shown in the preview.
 *
 * Splitting exists because one meeting entry routinely carries five different lifetimes:
 * the meeting record is history, an action is open until someone does it, a risk stays
 * live, and a fact belongs to the record itself. Confirming or dismissing them as one
 * unit forces the wrong decision on at least one of them.
 */
export interface SplitPart {
  kind: "meeting" | "action" | "decision" | "risk" | "fact";
  title: string;
  body: string;
}

export function planMeetingSplit(details: MeetingCardDetails): SplitPart[] {
  const parts: SplitPart[] = [{
    kind: "meeting",
    title: details.title,
    body: [
      details.summary,
      details.attendees.length ? `Attendees: ${details.attendees.join(", ")}` : "",
      details.remainder,
    ].filter(Boolean).join("\n\n") || details.title,
  }];

  for (const decision of details.decisions) {
    parts.push({ kind: "decision", title: decision.slice(0, 120), body: decision });
  }
  for (const item of details.actionItems) {
    const suffix = [item.owner && `Owner: ${item.owner}`, item.dueDate && `Due: ${item.dueDate}`]
      .filter(Boolean).join(" · ");
    parts.push({
      kind: "action",
      title: item.description.slice(0, 120),
      body: suffix ? `${item.description}\n\n${suffix}` : item.description,
    });
  }
  for (const risk of details.risks) {
    parts.push({ kind: "risk", title: risk.slice(0, 120), body: risk });
  }
  for (const question of details.openQuestions) {
    parts.push({ kind: "fact", title: question.slice(0, 120), body: `Open question: ${question}` });
  }
  return parts;
}
