import type { ReviewCardStatus } from "@/lib/content/reviewInbox";

export const REVIEW_KIND_GROUPS = [
  "meetings",
  "decisions",
  "actions",
  "risks",
  "facts",
  "record-changes",
  "references",
] as const;
export type ReviewKindGroup = (typeof REVIEW_KIND_GROUPS)[number];

export const REVIEW_KIND_GROUP_LABELS: Record<ReviewKindGroup, string> = {
  meetings: "Meetings",
  decisions: "Decisions",
  actions: "Actions",
  risks: "Risks",
  facts: "Facts",
  "record-changes": "Record changes",
  references: "References",
};

/**
 * Nine entry kinds condense into the seven filters the mailbox offers.
 *
 * `open-question` and `lesson` join `fact` rather than getting chips of their own: both are
 * things learned rather than things to do, and a filter row long enough to need its own
 * scrollbar filters nothing in practice.
 */
export function kindGroupFor(entryKind: string | null): ReviewKindGroup | null {
  switch (entryKind) {
    case "meeting": return "meetings";
    case "decision": return "decisions";
    case "action": return "actions";
    case "risk": return "risks";
    case "fact":
    case "lesson":
    case "open-question": return "facts";
    case "record-change": return "record-changes";
    case "reference": return "references";
    default: return null;
  }
}

export const REVIEW_SORTS = ["newest", "oldest", "workspace", "kind"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export const REVIEW_SORT_LABELS: Record<ReviewSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  workspace: "By workspace",
  kind: "By kind",
};

export type ReviewVisibilityFilter = "internal" | "client-visible";

export interface ReviewListItem {
  id: string;
  status: ReviewCardStatus;
  entryKind: string | null;
  visibility: ReviewVisibilityFilter | null;
  workspaceKind: string;
  workspaceSlug: string;
  workspaceLabel: string;
  /** The entry's own timestamp when it has one, otherwise when Mi imported it. */
  sortedAt: string;
  title: string;
}

export interface ReviewFilterState {
  statuses: ReviewCardStatus[];
  kinds: ReviewKindGroup[];
  visibilities: ReviewVisibilityFilter[];
  workspace: string;
  query: string;
  sort: ReviewSort;
}

export const DEFAULT_REVIEW_FILTERS: ReviewFilterState = {
  statuses: ["pending", "failed"],
  kinds: [],
  visibilities: [],
  workspace: "",
  query: "",
  sort: "newest",
};

function matchesQuery(item: ReviewListItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${item.title} ${item.workspaceLabel} ${item.workspaceSlug}`.toLowerCase().includes(needle);
}

/**
 * Filtering is subtractive and every dimension is optional: an empty chip list means "all
 * of this dimension", not "none". Selecting nothing showing nothing is the single most
 * common way a filter bar gets mistaken for a broken page.
 */
export function filterReviewItems(items: ReviewListItem[], filters: ReviewFilterState): ReviewListItem[] {
  return items.filter((item) => {
    if (filters.statuses.length > 0 && !filters.statuses.includes(item.status)) return false;
    if (filters.kinds.length > 0) {
      const group = kindGroupFor(item.entryKind);
      if (!group || !filters.kinds.includes(group)) return false;
    }
    if (filters.visibilities.length > 0) {
      if (!item.visibility || !filters.visibilities.includes(item.visibility)) return false;
    }
    if (filters.workspace && `${item.workspaceKind}/${item.workspaceSlug}` !== filters.workspace) return false;
    return matchesQuery(item, filters.query);
  });
}

export function sortReviewItems(items: ReviewListItem[], sort: ReviewSort): ReviewListItem[] {
  const sorted = [...items];
  if (sort === "oldest") {
    return sorted.sort((left, right) => left.sortedAt.localeCompare(right.sortedAt) || left.id.localeCompare(right.id));
  }
  if (sort === "workspace") {
    return sorted.sort((left, right) =>
      left.workspaceLabel.localeCompare(right.workspaceLabel)
      || right.sortedAt.localeCompare(left.sortedAt));
  }
  if (sort === "kind") {
    return sorted.sort((left, right) =>
      (kindGroupFor(left.entryKind) ?? "zzz").localeCompare(kindGroupFor(right.entryKind) ?? "zzz")
      || right.sortedAt.localeCompare(left.sortedAt));
  }
  return sorted.sort((left, right) => right.sortedAt.localeCompare(left.sortedAt) || left.id.localeCompare(right.id));
}

export function applyReviewFilters(
  items: ReviewListItem[],
  filters: ReviewFilterState,
): ReviewListItem[] {
  return sortReviewItems(filterReviewItems(items, filters), filters.sort);
}

/** Chip counts are computed before that dimension's own filter, so a chip never reads zero
 *  purely because it is the chip you have selected. */
export function kindGroupCounts(
  items: ReviewListItem[],
  filters: ReviewFilterState,
): Record<ReviewKindGroup, number> {
  const base = filterReviewItems(items, { ...filters, kinds: [] });
  const counts = Object.fromEntries(REVIEW_KIND_GROUPS.map((group) => [group, 0])) as Record<ReviewKindGroup, number>;
  for (const item of base) {
    const group = kindGroupFor(item.entryKind);
    if (group) counts[group] += 1;
  }
  return counts;
}
