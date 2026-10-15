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

interface LessonEntry {
  projectSlug: string;
  projectName: string;
  contentHtml: string;
  searchText: string;
}

export function LessonsBrowser({ entries }: { entries: LessonEntry[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"project" | "content">("project");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter(
        (entry) => !q
          || entry.projectName.toLowerCase().includes(q)
          || entry.searchText.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        if (sort === "content") {
          return b.searchText.length - a.searchText.length
            || a.projectName.localeCompare(b.projectName, "en");
        }
        return a.projectName.localeCompare(b.projectName, "en");
      });
  }, [entries, query, sort]);

  const filtersActive = Boolean(query.trim() || sort !== "project");

  return (
    <div className="flex flex-col gap-4">
      <AdvancedListToolbar columnsClassName="md:grid-cols-[minmax(0,1fr)_14rem]">
        <AdvancedListField label="Search lessons">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Project or lesson text..."
            className={advancedListControlClass}
          />
        </AdvancedListField>
        <AdvancedListField label="Sort by">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as "project" | "content")}
            className={advancedListControlClass}
          >
            <option value="project">Project name</option>
            <option value="content">Most detailed</option>
          </select>
        </AdvancedListField>
      </AdvancedListToolbar>
      <AdvancedListSummary
        shown={filtered.length}
        total={entries.length}
        noun="project lesson"
        filtersActive={filtersActive}
        onClear={() => {
          setQuery("");
          setSort("project");
        }}
      />
      <div className="flex flex-col gap-4">
        {filtered.map((entry) => (
          <div key={entry.projectSlug} className="rounded-lg border border-border p-4">
            <Link
              href={`/projects/${entry.projectSlug}`}
              className="text-sm font-medium hover:underline"
            >
              {entry.projectName}
            </Link>
            <div
              className="prose prose-sm mt-2 max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: entry.contentHtml }}
            />
          </div>
        ))}
        {filtered.length === 0 ? (
          <AdvancedListEmpty>
            {entries.length === 0 ? "No lessons have been recorded yet." : "No lessons match the selected filters."}
          </AdvancedListEmpty>
        ) : null}
      </div>
    </div>
  );
}
