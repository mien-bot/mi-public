import {
  REVIEW_KIND_GROUPS,
  REVIEW_KIND_GROUP_LABELS,
  kindGroupFor,
  type ReviewKindGroup,
} from "@/components/reviewInboxFilters";
import type { ProjectMemory, ProjectMemorySection } from "./projectWorkspace";

/**
 * Sections that carry no kind, because nothing recorded one.
 *
 * Hand-written notes and older confirmed entries genuinely have no kind, and guessing one
 * from the prose would be inventing metadata. They group together and stay first-class.
 */
export const GENERAL_KNOWLEDGE_GROUP = "general" as const;

export type KnowledgeGroup = ReviewKindGroup | typeof GENERAL_KNOWLEDGE_GROUP;

export const KNOWLEDGE_GROUPS: readonly KnowledgeGroup[] = [
  ...REVIEW_KIND_GROUPS,
  GENERAL_KNOWLEDGE_GROUP,
];

export const KNOWLEDGE_GROUP_LABELS: Record<KnowledgeGroup, string> = {
  ...REVIEW_KIND_GROUP_LABELS,
  [GENERAL_KNOWLEDGE_GROUP]: "General notes",
};

export interface KnowledgeEntry {
  /** Stable within one file: the section's position, which is also its append order. */
  id: string;
  group: KnowledgeGroup;
  /** The entry kind Mi recorded, or null for a section that never had one. */
  entryKind: string | null;
  /** ISO date from the heading, or null. Sorting falls back to file order without it. */
  date: string | null;
  /** The heading with Mi's own "<kind> note — <date> — " prefix removed. */
  title: string;
  body: string;
  /** The untouched `## ` heading, so a person can still find the line in the file. */
  heading: string;
}

/**
 * Mi's own heading shape: `fact note — 2026-08-26 — Restaurant has separate exits`.
 *
 * Written by `renderNoteSection` (lib/content/reviewInboxApply.ts) on every confirmed
 * review card. Keeping the parse tied to that one shape is deliberate — a looser pattern
 * would start classifying hand-written headings by accident, and a wrong kind is worse
 * than none.
 */
/* Numbered rather than named groups: this repository's TypeScript target predates them. */
const MI_HEADING = /^([a-z][a-z-]*)\s+note\s+[—–-]\s+(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(.+)$/i;

export function classifyKnowledgeSection(section: ProjectMemorySection, index: number): KnowledgeEntry {
  const match = MI_HEADING.exec(section.title.trim());
  if (!match) {
    return {
      id: `section-${index}`,
      group: GENERAL_KNOWLEDGE_GROUP,
      entryKind: null,
      date: null,
      title: section.title,
      body: section.body,
      heading: section.title,
    };
  }
  const entryKind = match[1].toLowerCase();
  return {
    id: `section-${index}`,
    group: kindGroupFor(entryKind) ?? GENERAL_KNOWLEDGE_GROUP,
    entryKind,
    date: match[2],
    title: match[3].trim(),
    body: section.body,
    heading: section.title,
  };
}

export interface ProjectKnowledge {
  entries: KnowledgeEntry[];
  /** Every group, in a fixed order, so an empty one can still be shown as empty. */
  counts: Record<KnowledgeGroup, number>;
  total: number;
  lastUpdated: string | null;
  relativePath: string;
  preamble: string;
}

/**
 * Turns one long notes file into something browsable.
 *
 * `memory/notes.md` is append-only by design: every confirmed fact, risk, decision and
 * meeting note lands at the end of it, so on a busy project it becomes hundreds of lines of
 * undifferentiated scroll — the file grows exactly as fast as the project goes well. This
 * does not change what is stored. It reads the kind Mi already puts in each heading and
 * gives the reader an axis to cut it by, so the file gets *more* navigable as it grows
 * rather than less.
 */
export function readProjectKnowledge(memory: ProjectMemory | null): ProjectKnowledge | null {
  if (!memory) return null;
  const entries = memory.sections.map(classifyKnowledgeSection);
  const counts = Object.fromEntries(
    KNOWLEDGE_GROUPS.map((group) => [group, 0]),
  ) as Record<KnowledgeGroup, number>;
  for (const entry of entries) counts[entry.group] += 1;
  return {
    entries,
    counts,
    total: entries.length,
    lastUpdated: memory.lastUpdated,
    relativePath: memory.relativePath,
    preamble: memory.preamble,
  };
}

/**
 * Newest first, with undated entries after dated ones rather than mixed among them.
 *
 * An entry with no date is almost always older hand-written knowledge; floating it to the
 * top on a tie would push the thing that actually happened this week below it.
 */
export function sortKnowledgeEntries(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  return [...entries].sort((left, right) => {
    if (left.date && right.date) return right.date.localeCompare(left.date);
    if (left.date) return -1;
    if (right.date) return 1;
    return 0;
  });
}

export function searchKnowledgeEntries(entries: KnowledgeEntry[], query: string): KnowledgeEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) =>
    entry.title.toLowerCase().includes(needle) || entry.body.toLowerCase().includes(needle));
}
