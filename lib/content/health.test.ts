import { describe, expect, it } from "vitest";
import { computeProjectHealth, explainProjectHealth, type ProjectHealth } from "./health";

describe("explainProjectHealth", () => {
  it("explains each weighted deduction behind the score", () => {
    const health: ProjectHealth = {
      score: 70,
      bucket: "warning",
      breakdown: {
        overdueMilestones: 2,
        overBudgetCategories: 0,
        atRiskMilestones: 0,
        warningBudgetCategories: 0,
        stalePermits: 0,
        staleReviews: 0,
        incompleteChecklistItems: 0,
      },
    };

    expect(explainProjectHealth(health)).toBe(
      "Health starts at 100. 2 overdue milestones: −30. Current score: 70.",
    );
  });
  it("preserves the existing deduction weights in the pure calculator", () => {
    expect(computeProjectHealth({
      overdueMilestones: 1,
      overBudgetCategories: 1,
      atRiskMilestones: 1,
      warningBudgetCategories: 1,
      stalePermits: 1,
      staleReviews: 1,
      incompleteChecklistItems: 2,
    })).toMatchObject({
      score: 34,
      bucket: "danger",
    });
  });
});
