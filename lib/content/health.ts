import { getProjectUrgency, type ProjectUrgency } from "./urgency";

export interface ProjectHealth {
  score: number; // 0-100, 100 = perfectly healthy
  bucket: "success" | "warning" | "danger" | "neutral";
  breakdown: ProjectUrgency;
}

/**
 * Weighted composite of getProjectUrgency's existing signals into one
 * number — heaviest penalty for overdue milestones / over-budget
 * categories, lighter for at-risk/warning/stale/incomplete-checklist
 * signals. Not a new data source, just a different view of what
 * getProjectUrgency already computes.
 */
const WEIGHTS: Record<keyof ProjectUrgency, number> = {
  overdueMilestones: 15,
  overBudgetCategories: 15,
  atRiskMilestones: 8,
  warningBudgetCategories: 8,
  stalePermits: 8,
  staleReviews: 8,
  incompleteChecklistItems: 2,
};

const SIGNAL_LABELS: Record<keyof ProjectUrgency, [string, string]> = {
  overdueMilestones: ["overdue milestone", "overdue milestones"],
  overBudgetCategories: ["over-budget category", "over-budget categories"],
  atRiskMilestones: ["at-risk milestone", "at-risk milestones"],
  warningBudgetCategories: ["budget-warning category", "budget-warning categories"],
  stalePermits: ["stale permit", "stale permits"],
  staleReviews: ["stale review", "stale reviews"],
  incompleteChecklistItems: ["incomplete checklist item", "incomplete checklist items"],
};

export function explainProjectHealth(health: ProjectHealth): string {
  const deductions = (Object.keys(WEIGHTS) as (keyof ProjectUrgency)[])
    .filter((key) => health.breakdown[key] > 0)
    .map((key) => {
      const count = health.breakdown[key];
      const label = SIGNAL_LABELS[key][count === 1 ? 0 : 1];
      return `${count} ${label}: −${count * WEIGHTS[key]}`;
    });

  return deductions.length > 0
    ? `Health starts at 100. ${deductions.join("; ")}. Current score: ${health.score}.`
    : `Health starts at 100. No current deductions. Current score: ${health.score}.`;
}

/** Pure health calculation for callers that have already loaded the source records. */
export function computeProjectHealth(breakdown: ProjectUrgency): ProjectHealth {
  const penalty = (Object.keys(WEIGHTS) as (keyof ProjectUrgency)[]).reduce(
    (sum, key) => sum + breakdown[key] * WEIGHTS[key],
    0,
  );
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const bucket = score >= 80 ? "success" : score >= 50 ? "warning" : "danger";

  return { score, bucket, breakdown };
}

export function getProjectHealth(slug: string, today: Date = new Date()): ProjectHealth {
  return computeProjectHealth(getProjectUrgency(slug, today));
}
