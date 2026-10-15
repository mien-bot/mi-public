import type { BudgetCategory, Milestone } from "@/lib/schema";

export type MilestoneStatus = "complete" | "overdue" | "at-risk" | "on-track";

const AT_RISK_WINDOW_DAYS = 14;

/**
 * Computed from dates rather than authored, so editors never have to keep a
 * manual status field in sync with reality.
 */
export function computeMilestoneStatus(milestone: Pick<Milestone, "planned_date" | "actual_date">, today: Date = new Date()): MilestoneStatus {
  if (milestone.actual_date) return "complete";

  const planned = new Date(milestone.planned_date);
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysUntilPlanned = (planned.getTime() - today.getTime()) / msPerDay;

  if (daysUntilPlanned < 0) return "overdue";
  if (daysUntilPlanned <= AT_RISK_WINDOW_DAYS) return "at-risk";
  return "on-track";
}

export type BudgetStatus = "on-track" | "warning" | "over";

const WARNING_THRESHOLD = 0.9;

/** Warns before a category actually goes over budget, not just after. */
export function computeBudgetStatus(category: Pick<BudgetCategory, "budgeted" | "actual">): BudgetStatus {
  if (category.budgeted <= 0) return category.actual > 0 ? "over" : "on-track";
  const ratio = category.actual / category.budgeted;
  if (ratio > 1) return "over";
  if (ratio >= WARNING_THRESHOLD) return "warning";
  return "on-track";
}
