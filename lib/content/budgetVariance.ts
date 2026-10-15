import { computeBudgetStatus, type BudgetStatus } from "./status";
import { getBudget } from "./projects";

export interface BudgetVarianceEntry {
  name: string;
  budgeted: number;
  actual: number;
  variance: number;
  percentVariance: number;
  status: BudgetStatus;
}

/** Adds the actual variance amount/% on top of the existing on-track/warning/over bucket — the budget page currently only shows raw dollars + that bucket. */
export function getBudgetVariance(slug: string): BudgetVarianceEntry[] {
  return getBudget(slug).categories.map((category) => {
    const variance = category.actual - category.budgeted;
    return {
      name: category.name,
      budgeted: category.budgeted,
      actual: category.actual,
      variance,
      percentVariance: category.budgeted === 0 ? 0 : Math.round((variance / category.budgeted) * 100),
      status: computeBudgetStatus(category),
    };
  });
}
