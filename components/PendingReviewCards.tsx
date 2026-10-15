"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReviewBulkConfirm } from "@/components/ReviewBulkConfirm";
import { ReviewCardPanel } from "@/components/ReviewCardPanel";
import type { ReviewCardView } from "@/lib/content/reviewInboxService";

function title(view: ReviewCardView): string {
  return view.content?.title || view.card.source.file_name;
}

function when(view: ReviewCardView): string {
  const stamp = view.card.source.created_at ?? view.card.imported_at;
  return stamp.slice(0, 10);
}

/**
 * A record's pending cards: a queue you can scan, not a wall you scroll past.
 *
 * Two things live here that used to be somewhere else. Bulk confirmation only existed in
 * the mailbox, so a terminal session that filed eight entries meant eight trips through
 * this panel or a detour to `/review`. And every card rendered in full, so a project with a
 * real backlog turned its own overview into several screens of review queue — the panel
 * meant to answer "is anything waiting on this?" was the reason the answer was hard to see.
 *
 * So rows are collapsed by default and open in place. What opens is the ordinary
 * `ReviewCardPanel`, deliberately: the panel and the mailbox must never drift into showing
 * or allowing different things about the same card, and only the default disclosure differs
 * between them.
 */
export function PendingReviewCards({ views }: { views: ReviewCardView[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);

  const pending = views.filter((view) => view.card.status === "pending");
  const selectable = pending.length > 1;
  const selectedViews = views.filter((view) => selected.includes(view.card.id));
  const allSelected = pending.length > 0 && pending.every((view) => selected.includes(view.card.id));

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {selectable && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelected(allSelected ? [] : pending.map((view) => view.card.id))}
            className="rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:border-accent"
          >
            {allSelected ? "Deselect all" : `Select all ${pending.length} pending`}
          </button>
          <button
            type="button"
            onClick={() => setExpanded(expanded.length === views.length ? [] : views.map((view) => view.card.id))}
            className="rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:border-accent"
          >
            {expanded.length === views.length ? "Collapse all" : "Expand all"}
          </button>
          <span className="text-xs text-muted-foreground">
            Bulk confirmation still previews every write before it happens.
          </span>
        </div>
      )}

      {selectable && (
        <ReviewBulkConfirm
          selectedViews={selectedViews}
          onClearSelection={() => setSelected([])}
          onApplied={() => router.refresh()}
        />
      )}

      <ul className="flex flex-col gap-2">
        {views.map((view) => {
          const id = view.card.id;
          const isOpen = expanded.includes(id);
          return (
            <li key={id} className="flex items-start gap-3">
              {selectable && view.card.status === "pending" && (
                <input
                  type="checkbox"
                  checked={selected.includes(id)}
                  onChange={() => setSelected((current) => toggle(current, id))}
                  aria-label={`Select ${title(view)}`}
                  className={`h-4 w-4 ${isOpen ? "mt-5" : "mt-3"}`}
                />
              )}
              <div className="min-w-0 flex-1">
                {isOpen ? (
                  <ReviewCardPanel view={view} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => toggle(current, id))}
                    aria-expanded={false}
                    className="tactile-control flex w-full items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:border-accent"
                  >
                    {view.card.status !== "pending" && (
                      <span className="shrink-0 rounded border border-destructive/60 bg-destructive/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-destructive">
                        {view.card.status}
                      </span>
                    )}
                    {view.card.entry_kind && (
                      <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {view.card.entry_kind}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">{title(view)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{when(view)}</span>
                    <span className="shrink-0 text-xs text-link">Review</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
