"use client";

import { useMemo, useState } from "react";
import {
  KNOWLEDGE_GROUPS,
  KNOWLEDGE_GROUP_LABELS,
  searchKnowledgeEntries,
  sortKnowledgeEntries,
  type KnowledgeEntry,
  type KnowledgeGroup,
  type ProjectKnowledge,
} from "@/lib/content/projectKnowledge";

const PREVIEW_LIMIT = 320;

function Entry({ entry }: { entry: KnowledgeEntry }) {
  const [expanded, setExpanded] = useState(false);
  const long = entry.body.length > PREVIEW_LIMIT;
  return (
    <li className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{entry.title}</h3>
        <span className="text-xs text-muted-foreground">
          {entry.date ?? "no date recorded"}
          {entry.entryKind ? ` · ${entry.entryKind}` : ""}
        </span>
      </div>
      {entry.body && (
        <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
          {expanded || !long ? entry.body : `${entry.body.slice(0, PREVIEW_LIMIT)}…`}
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="ml-2 text-xs text-link underline-offset-2 hover:underline"
            >
              {expanded ? "Show less" : "Show all"}
            </button>
          )}
        </p>
      )}
    </li>
  );
}

/**
 * Everything this project knows, in one place you can actually read.
 *
 * `memory/notes.md` is append-only: every confirmed fact, risk, decision and meeting note
 * lands at the end of it. That is the right way to store it — nothing is ever rewritten or
 * lost — and the wrong way to read it, because the file grows exactly as fast as the work
 * goes well. A project three months in is several hundred lines of undifferentiated scroll,
 * previewed five entries at a time at the bottom of the overview.
 *
 * Nothing here changes the file. It groups by the kind Mi already records in each heading,
 * defaults to newest first, and lets you cut it by group or by search. Sections written by
 * hand keep their own group rather than being guessed at.
 */
export function ProjectKnowledgeBrowser({ knowledge }: { knowledge: ProjectKnowledge }) {
  const [group, setGroup] = useState<KnowledgeGroup | "all">("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const byGroup = group === "all"
      ? knowledge.entries
      : knowledge.entries.filter((entry) => entry.group === group);
    return sortKnowledgeEntries(searchKnowledgeEntries(byGroup, query));
  }, [knowledge.entries, group, query]);

  // Only groups that actually hold something: a row of zeroes is a filter bar that filters
  // nothing, and it is the same clutter this page exists to clear.
  const populated = KNOWLEDGE_GROUPS.filter((candidate) => knowledge.counts[candidate] > 0);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-border bg-card p-4" aria-label="Filter project knowledge">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setGroup("all")}
            aria-pressed={group === "all"}
            className={`tactile-control rounded-full border px-3 py-1 text-xs transition-colors ${
              group === "all" ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:border-accent"
            }`}
          >
            Everything <span className="opacity-70">{knowledge.total}</span>
          </button>
          {populated.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => setGroup(candidate)}
              aria-pressed={group === candidate}
              className={`tactile-control rounded-full border px-3 py-1 text-xs transition-colors ${
                group === candidate ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:border-accent"
              }`}
            >
              {KNOWLEDGE_GROUP_LABELS[candidate]} <span className="opacity-70">{knowledge.counts[candidate]}</span>
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Any word in a note"
            className="min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
      </section>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {knowledge.total === 0
            ? "Nothing has been confirmed into this project's knowledge yet."
            : `No note matches that. ${knowledge.total} note(s) in total.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((entry) => <Entry key={entry.id} entry={entry} />)}
        </ul>
      )}
    </div>
  );
}
