"use client";

import { useMemo, useState } from "react";
import type { ScheduleEntry } from "@/lib/notion/projectMap";
import { NotionDateTime } from "./NotionDateTime";
import { NotionLink } from "./NotionLink";

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;

export function paginateScheduleEntries(entries: ScheduleEntry[], page: number, pageSize: number) {
  const newestFirst = [...entries].reverse();
  const pageCount = Math.max(1, Math.ceil(newestFirst.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    entries: newestFirst.slice(start, start + pageSize),
    page: safePage,
    pageCount,
    from: newestFirst.length === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, newestFirst.length),
    total: newestFirst.length,
  };
}

export function NotionScheduleActivity({ entries }: { entries: ScheduleEntry[] }) {
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const result = useMemo(
    () => paginateScheduleEntries(entries, page, pageSize),
    [entries, page, pageSize],
  );

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Linked STUDIO Schedule activity</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Showing {result.from}–{result.to} of {result.total}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Show
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
            className="rounded-md border border-border bg-card px-2 py-1 text-foreground outline-none focus:border-accent"
          >
            {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
          per page
        </label>
      </div>

      <ul className="mt-2 grid gap-2 text-sm md:grid-cols-2">
        {result.entries.map((entry) => (
          <li key={entry.notion_page_id} className="rounded-md border border-border/70 p-2">
            <NotionLink href={entry.notion_url}>{entry.name}</NotionLink>
            <div className="text-xs text-muted-foreground">
              {entry.date || entry.do_date
                ? <NotionDateTime value={entry.date || entry.do_date!} />
                : "No date"}
              {entry.types.length > 0 ? ` · ${entry.types.join(", ")}` : ""}
            </div>
          </li>
        ))}
      </ul>

      {result.pageCount > 1 && (
        <nav className="mt-3 flex items-center justify-end gap-2" aria-label="Schedule activity pages">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={result.page === 1}
            className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-muted-foreground">
            Page {result.page} of {result.pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(result.pageCount, current + 1))}
            disabled={result.page === result.pageCount}
            className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
