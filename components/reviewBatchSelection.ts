import type { ReviewCardView } from "@/lib/content/reviewInboxService";

// Agent-supplied IDs are unique within an inbox, not necessarily across projects.
export function reviewSelectionId(view: ReviewCardView) {
  return JSON.stringify([view.workspace.kind, view.workspace.slug, view.card.id]);
}

export function groupReviewSelection(views: ReviewCardView[]) {
  const groups = new Map<string, ReviewCardView[]>();
  for (const view of views) {
    const key = `${view.workspace.kind}/${view.workspace.slug}`;
    groups.set(key, [...(groups.get(key) ?? []), view]);
  }
  return Array.from(groups, ([key, items]) => ({
    key, workspace: items[0].workspace, items,
    destinations: items[0].destinations.filter(option => option.available && items.every(item =>
      item.destinations.some(candidate => candidate.ref.kind === option.ref.kind && candidate.available))),
  }));
}
