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
  return Array.from(groups, ([key, items]) => {
    const destinations = items[0].destinations.filter(option => option.available && items.every(item =>
      item.destinations.some(candidate => candidate.ref.kind === option.ref.kind && candidate.available)));
    // One unsavable card must not silently blank the whole group, so name it and its reason.
    const unsavable = items.filter(item => !item.destinations.some(option => option.available));
    const reasons = [...new Set(items.flatMap(item => item.destinations)
      .filter(option => !option.available && option.unavailableReason)
      .map(option => option.unavailableReason))];
    return { key, workspace: items[0].workspace, items, destinations, unsavable, reasons };
  });
}
