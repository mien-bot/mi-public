import { computeBudgetStatus, computeMilestoneStatus } from "./status";
import { getBudget, getChecklist, getQaqcChecklist, getSchedule } from "./projects";
import { getPermitAging } from "./permitAging";
import { getChecklistCompletion } from "./completion";
import { getReviewAging } from "./reviewAging";

export interface ProjectUrgency {
  overdueMilestones: number;
  atRiskMilestones: number;
  overBudgetCategories: number;
  warningBudgetCategories: number;
  stalePermits: number;
  incompleteChecklistItems: number;
  staleReviews: number;
}

/** Rolls up computed schedule/budget/permit/checklist status for a project, for list-view flags. */
export function getProjectUrgency(slug: string, today: Date = new Date()): ProjectUrgency {
  const schedule = getSchedule(slug);
  const budget = getBudget(slug);

  let overdueMilestones = 0;
  let atRiskMilestones = 0;
  for (const milestone of schedule.milestones) {
    const status = computeMilestoneStatus(milestone, today);
    if (status === "overdue") overdueMilestones++;
    else if (status === "at-risk") atRiskMilestones++;
  }

  let overBudgetCategories = 0;
  let warningBudgetCategories = 0;
  for (const category of budget.categories) {
    const status = computeBudgetStatus(category);
    if (status === "over") overBudgetCategories++;
    else if (status === "warning") warningBudgetCategories++;
  }

  const stalePermits = getPermitAging(slug, today).filter((p) => p.stale).length;

  const codeCompliance = getChecklistCompletion(getChecklist(slug));
  const qaqc = getChecklistCompletion(getQaqcChecklist(slug));
  const incompleteChecklistItems =
    codeCompliance.pending + codeCompliance.inProgress + qaqc.pending + qaqc.inProgress;

  const staleReviews = getReviewAging(slug, today).filter((r) => r.stale).length;

  return {
    overdueMilestones,
    atRiskMilestones,
    overBudgetCategories,
    warningBudgetCategories,
    stalePermits,
    incompleteChecklistItems,
    staleReviews,
  };
}
