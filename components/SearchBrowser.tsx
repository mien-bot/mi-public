"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AdvancedListEmpty,
  AdvancedListField,
  AdvancedListSummary,
  AdvancedListToolbar,
  advancedListControlClass,
} from "@/components/AdvancedListUI";
import type { SearchEntry, SearchEntryType } from "@/lib/content/searchIndex";

export const SEARCH_TYPE_LABELS: Record<SearchEntryType, string> = {
  "project-file": "Project file",
  handoff: "Shared handoff",
  project: "Project",
  code: "Code",
  "mep-faq": "MEP FAQ",
  "lessons-learned": "Lessons Learned",
  "checklist-item": "Checklist",
  lead: "Lead",
  client: "Client",
  markup: "Markup",
  drawing: "Drawing",
  permit: "Permit",
  "qaqc-item": "QA/QC",
  submission: "Submission",
  contract: "Contract",
  inspiration: "Inspiration",
  "library-document": "Library Document",
  "qaqc-engagement": "Permit QAQC",
  decision: "Decision",
  "site-report": "Site Report",
  "architect-tool": "Architect Tool",
};

export function SearchBrowser({ entries }: { entries: SearchEntry[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<SearchEntryType | "all">("all");
  const [sort, setSort] = useState<"relevance" | "title" | "type">("relevance");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return entries
      .filter((entry) => (
        (type === "all" || entry.type === type)
        && entry.searchText.toLowerCase().includes(q)
      ))
      .sort((a, b) => {
        if (sort === "title") return a.title.localeCompare(b.title, "en");
        if (sort === "type") {
          return SEARCH_TYPE_LABELS[a.type].localeCompare(SEARCH_TYPE_LABELS[b.type], "en")
            || a.title.localeCompare(b.title, "en");
        }
        const aTitle = a.title.toLowerCase().includes(q) ? 0 : 1;
        const bTitle = b.title.toLowerCase().includes(q) ? 0 : 1;
        return aTitle - bTitle || a.title.localeCompare(b.title, "en");
      });
  }, [entries, query, sort, type]);
  const results = matches.slice(0, 100);

  const availableTypes = useMemo(
    () => [...new Set(entries.map((entry) => entry.type))]
      .sort((a, b) => SEARCH_TYPE_LABELS[a].localeCompare(SEARCH_TYPE_LABELS[b], "en")),
    [entries],
  );
  const filtersActive = type !== "all" || sort !== "relevance";

  return (
    <div className="flex flex-col gap-4">
      <AdvancedListToolbar columnsClassName="md:grid-cols-[minmax(0,1fr)_14rem_14rem]">
        <AdvancedListField label="Search everything">
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Projects, codes, records, library..."
            className={advancedListControlClass}
          />
        </AdvancedListField>
        <AdvancedListField label="Record type">
          <select
            value={type}
            onChange={(event) => setType(event.target.value as SearchEntryType | "all")}
            className={advancedListControlClass}
          >
            <option value="all">All record types</option>
            {availableTypes.map((value) => (
              <option key={value} value={value}>{SEARCH_TYPE_LABELS[value]}</option>
            ))}
          </select>
        </AdvancedListField>
        <AdvancedListField label="Sort by">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as "relevance" | "title" | "type")}
            className={advancedListControlClass}
          >
            <option value="relevance">Best match</option>
            <option value="title">Title</option>
            <option value="type">Record type</option>
          </select>
        </AdvancedListField>
      </AdvancedListToolbar>
      {query.trim() === "" && (
        <AdvancedListEmpty>Start typing to search across all reviewed Mi records.</AdvancedListEmpty>
      )}
      {query.trim() !== "" && (
        <div className="flex flex-col gap-2">
          <AdvancedListSummary
            shown={results.length}
            total={matches.length}
            noun="matching record"
            filtersActive={filtersActive}
            onClear={() => {
              setType("all");
              setSort("relevance");
            }}
          />
          {results.map((r) => (
            <Link
              key={r.id}
              href={r.href}
              className="card-hover flex flex-col gap-3 rounded-md border border-border p-3 text-sm hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="break-words font-medium">{r.title}</div>
                <div className="break-words text-muted-foreground">{r.subtitle}</div>
              </div>
              <span className="shrink-0 self-start rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground sm:self-auto">
                {SEARCH_TYPE_LABELS[r.type]}
              </span>
            </Link>
          ))}
          {results.length === 0 ? (
            <AdvancedListEmpty>No indexed records match this search and record type.</AdvancedListEmpty>
          ) : null}
        </div>
      )}
    </div>
  );
}
