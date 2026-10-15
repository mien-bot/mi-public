"use client";

import { useMemo, useState, useEffect, useSyncExternalStore, type SetStateAction } from "react";
import { loadMiProfile, PROFILE_CHANGED_EVENT } from "./profilePreferences";
import { useRouter } from "next/navigation";
import { ReviewBatchConfirm } from "@/components/ReviewBatchConfirm";
import { reviewSelectionId } from "./reviewBatchSelection";
import { ReviewCardPanel } from "@/components/ReviewCardPanel";
import {
  DEFAULT_REVIEW_FILTERS,
  REVIEW_KIND_GROUPS,
  REVIEW_KIND_GROUP_LABELS,
  REVIEW_SORTS,
  REVIEW_SORT_LABELS,
  applyReviewFilters,
  kindGroupCounts,
  type ReviewFilterState,
  type ReviewKindGroup,
  type ReviewListItem,
  type ReviewVisibilityFilter,
} from "@/components/reviewInboxFilters";
import type { ReviewCardStatus } from "@/lib/content/reviewInbox";
import type { ReviewCardView } from "@/lib/content/reviewInboxService";

const STATUS_FILTERS: { status: ReviewCardStatus; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "failed", label: "Failed" },
  { status: "applied", label: "Applied" },
  { status: "dismissed", label: "Dismissed" },
  { status: "superseded", label: "Superseded" },
];

function subscribeProfile(callback: () => void) {
  window.addEventListener(PROFILE_CHANGED_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(PROFILE_CHANGED_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
function reviewerName() {
  try { return loadMiProfile(window.localStorage).displayName; } catch { return ""; }
}

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function ChipButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`tactile-control rounded-full border px-3 py-1 text-xs transition-colors ${
        active ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:border-accent"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The mailbox.
 *
 * Defaults to Pending + Failed rather than everything: the whole point of a mailbox is what
 * still needs you. History is one chip away, never the landing state.
 */
export function ReviewInboxBrowser({ views, workspaces, initialWorkspace = "" }: {
  views: ReviewCardView[];
  workspaces: { key: string; label: string; pending: number; failed: number }[];
  initialWorkspace?: string;
}) {
  const router = useRouter();
  const name = useSyncExternalStore(subscribeProfile, reviewerName, () => "");
  const [filters, updateFilters] = useState<ReviewFilterState>({ ...DEFAULT_REVIEW_FILTERS, workspace: initialWorkspace });
  const [selected, setSelected] = useState<string[]>([]);
  function setFilters(next: SetStateAction<ReviewFilterState>) {
    setSelected([]);
    updateFilters(next);
  }
  useEffect(() => {
    try {
      const sort = window.localStorage.getItem("mi.review.sort.v1");
      if (REVIEW_SORTS.includes(sort as ReviewFilterState["sort"])) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore this user's inbox order after hydration
        updateFilters(current => ({ ...current, sort: sort as ReviewFilterState["sort"] }));
      }
    } catch { /* Storage is optional. */ }
  }, []);

  const byId = useMemo(() => new Map(views.map((view) => [reviewSelectionId(view), view])), [views]);
  const items = useMemo<ReviewListItem[]>(() => views.map((view) => ({
    id: reviewSelectionId(view),
    status: view.card.status,
    entryKind: view.card.entry_kind,
    visibility: view.card.visibility,
    workspaceKind: view.workspace.kind,
    workspaceSlug: view.workspace.slug,
    workspaceLabel: view.workspace.label,
    sortedAt: view.card.source.created_at ?? view.card.imported_at,
    title: view.content?.title ?? view.card.source.file_name,
  })), [views]);

  const visible = useMemo(() => applyReviewFilters(items, filters), [items, filters]);
  const counts = useMemo(() => kindGroupCounts(items, filters), [items, filters]);

  const visibleIds = new Set(visible.map((item) => item.id));
  const selectedViews = selected.filter((id) => visibleIds.has(id)).map((id) => byId.get(id))
    .filter((view): view is ReviewCardView => Boolean(view) && view?.card.status === "pending");

  const pendingVisible = visible.filter((item) => item.status === "pending");
  const nextBatch = pendingVisible.slice(0, 100);
  const allPendingSelected = nextBatch.length > 0
    && nextBatch.every((item) => selected.includes(item.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">{name ? `${name}’s review queue` : "Your review queue"}</h2>
        <p className="text-xs text-muted-foreground">{selectedViews.length ? `${selectedViews.length} selected · ` : ""}{pendingVisible.length} pending in this view</p>
      </div>
      <section className="rounded-lg border border-border bg-card p-4" aria-label="Filters">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => router.refresh()} className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent">Refresh inbox</button>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</span>
          {STATUS_FILTERS.map((entry) => (
            <ChipButton
              key={entry.status}
              active={filters.statuses.includes(entry.status)}
              onClick={() => setFilters((current) => ({ ...current, statuses: toggle(current.statuses, entry.status) }))}
            >
              {entry.label}
            </ChipButton>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kind</span>
          {REVIEW_KIND_GROUPS.map((group: ReviewKindGroup) => (
            <ChipButton
              key={group}
              active={filters.kinds.includes(group)}
              onClick={() => setFilters((current) => ({ ...current, kinds: toggle(current.kinds, group) }))}
            >
              {REVIEW_KIND_GROUP_LABELS[group]} {counts[group] > 0 && <span className="opacity-70">{counts[group]}</span>}
            </ChipButton>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Visibility</span>
          {(["internal", "client-visible"] as ReviewVisibilityFilter[]).map((visibility) => (
            <ChipButton
              key={visibility}
              active={filters.visibilities.includes(visibility)}
              onClick={() => setFilters((current) => ({
                ...current,
                visibilities: toggle(current.visibilities, visibility),
              }))}
            >
              {visibility === "internal" ? "Internal" : "Client-visible"}
            </ChipButton>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Workspace
            <select
              value={filters.workspace}
              onChange={(event) => setFilters((current) => ({ ...current, workspace: event.target.value }))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            >
              <option value="">All workspaces</option>
              {workspaces.map((workspace) => (
                <option key={workspace.key} value={workspace.key}>
                  {workspace.label} ({workspace.pending} pending{workspace.failed > 0 ? `, ${workspace.failed} failed` : ""})
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Sort
            <select
              value={filters.sort}
              onChange={(event) => {
                try { window.localStorage.setItem("mi.review.sort.v1", event.target.value); } catch { /* Optional preference. */ }
                setFilters((current) => ({
                ...current,
                sort: event.target.value as ReviewFilterState["sort"],
              })); }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            >
              {REVIEW_SORTS.map((sort) => (
                <option key={sort} value={sort}>{REVIEW_SORT_LABELS[sort]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
            Search
            <input
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Title or workspace"
              className="min-w-[10rem] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              try { window.localStorage.removeItem("mi.review.sort.v1"); } catch { /* Optional preference. */ }
              setFilters(DEFAULT_REVIEW_FILTERS);
            }}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent"
          >
            Reset
          </button>
        </div>

        {pendingVisible.length > 0 && (
          // Scoped to what the filters are showing, never to the whole mailbox: "select all"
          // has to mean the cards on screen, or it selects work nobody just looked at.
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setSelected(allPendingSelected ? [] : nextBatch.map((item) => item.id))}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent"
            >
              {allPendingSelected
                ? "Deselect all"
                : pendingVisible.length > 100 ? `Select first 100 of ${pendingVisible.length} pending shown` : `Select all ${pendingVisible.length} pending shown`}
            </button>
            <span className="text-xs text-muted-foreground">
              Bulk confirmation still previews every write before it happens.
            </span>
          </div>
        )}
      </section>

      {pendingVisible.length > 0 && <section aria-label="Select by workspace" className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Choose projects to review together</h2>
        <p className="mt-1 text-xs text-muted-foreground">Select a whole workspace or individual items below. Your sort order is remembered on this device.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {workspaces.map(workspace => {
            const ids = pendingVisible.filter(item => `${item.workspaceKind}/${item.workspaceSlug}` === workspace.key).map(item => item.id);
            if (!ids.length) return null;
            const checked = ids.every(id => selected.includes(id));
            return <label key={workspace.key} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <input type="checkbox" checked={checked} onChange={() => setSelected(current => checked
                ? current.filter(id => !ids.includes(id)) : [...new Set([...current, ...ids])])} />
              {workspace.label} <span className="text-muted-foreground">{ids.length}</span>
            </label>;
          })}
        </div>
      </section>}

      <ReviewBatchConfirm
        selectedViews={selectedViews}
        onClearSelection={() => setSelected([])}
        onApplied={() => router.refresh()}
      />

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm">
          <p className="font-medium">{!items.some(item => item.status === "pending" || item.status === "failed") ? "You’re all caught up" : "Nothing matches these filters"}</p>
          <p className="mt-1 text-muted-foreground">Your review history stays available here.</p>
          <button type="button" onClick={() => setFilters({ ...DEFAULT_REVIEW_FILTERS, sort: filters.sort, statuses: ["applied"] })}
            className="mt-3 rounded-md border border-border px-3 py-2 text-xs">View saved items</button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((item) => {
            const view = byId.get(item.id);
            if (!view) return null;
            return (
              <li key={item.id} className="flex items-start gap-3">
                {view.card.status === "pending" && (
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={() => setSelected(toggle(selected, item.id))}
                    aria-label={`Select ${item.title}`}
                    className="mt-5 h-4 w-4"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <ReviewCardPanel view={view} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
