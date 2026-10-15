import type { Checklist } from "@/lib/schema";

export interface ChecklistCompletion {
  total: number;
  complete: number;
  pending: number;
  inProgress: number;
  flagged: number;
  percentComplete: number;
}

/** Reusable for both getChecklist() and getQaqcChecklist() — both use checklistSchema. */
export function getChecklistCompletion(checklist: Checklist | null): ChecklistCompletion {
  const items = checklist?.items ?? [];
  const total = items.length;
  const complete = items.filter((i) => i.status === "complete").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const inProgress = items.filter((i) => i.status === "in-progress").length;
  const flagged = items.filter((i) => i.status === "flagged").length;

  return {
    total,
    complete,
    pending,
    inProgress,
    flagged,
    percentComplete: total === 0 ? 0 : Math.round((complete / total) * 100),
  };
}
