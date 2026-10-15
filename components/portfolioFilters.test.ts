import { describe, expect, it } from "vitest";
import type { ProjectPortfolioSnapshot } from "@/lib/content/portfolioAnalytics";
import { filterAndSortPortfolioProjects } from "./portfolioFilters";

function entry(
  slug: string,
  overrides: Partial<ProjectPortfolioSnapshot> = {},
): ProjectPortfolioSnapshot {
  return {
    slug,
    name: slug,
    status: "in-progress",
    active: true,
    client: "",
    address: "",
    buildingType: null,
    healthScore: 100,
    healthBucket: "success",
    healthEvidenceState: "unmeasured",
    healthAssessment: "unmeasured",
    healthLabel: "Health unmeasured",
    healthExplanation: "",
    urgency: {
      overdueMilestones: 0,
      atRiskMilestones: 0,
      overBudgetCategories: 0,
      warningBudgetCategories: 0,
      stalePermits: 0,
      incompleteChecklistItems: 0,
      staleReviews: 0,
    },
    nextIncompleteMilestone: null,
    nextUpcomingMilestone: null,
    overdueMilestones: [],
    atRiskMilestones: [],
    milestoneHorizons: {
      overdue: 0,
      next7: 0,
      days8to30: 0,
      days31to90: 0,
      later: 0,
    },
    latestRecordedActivity: null,
    notionCreatedTime: null,
    populatedHealthAreas: [],
    populatedTrackingAreas: [],
    unpopulatedTrackingAreas: [],
    trackingCoverage: { populated: 0, total: 13 },
    notionLinkState: "missing",
    dropboxLinkState: "missing",
    budgetWarningCount: 0,
    overBudgetCount: 0,
    permitAging: [],
    staleReviewCount: 0,
    codeChecklist: {
      total: 0,
      complete: 0,
      pending: 0,
      inProgress: 0,
      flagged: 0,
      percentComplete: 0,
    },
    qaqc: {
      total: 0,
      complete: 0,
      pending: 0,
      inProgress: 0,
      flagged: 0,
      percentComplete: 0,
    },
    markup: {
      total: 0,
      open: 0,
      addressed: 0,
      superseded: 0,
      percentResolved: 0,
    },
    drawingCount: 0,
    populatedDrawingPhases: [],
    progressLogCount: 0,
    meetingNoteCount: 0,
    attentionReasons: [],
    attentionPriority: "none",
    attentionRank: Number.MAX_SAFE_INTEGER,
    ...overrides,
  };
}

describe("portfolio project filters", () => {
  it("defaults to active work and never includes not-started under Active", () => {
    const projects = [
      entry("active"),
      entry("future", { status: "not-started", active: false }),
      entry("done", { status: "complete", active: false }),
    ];

    expect(filterAndSortPortfolioProjects(projects).map((project) => project.slug))
      .toEqual(["active"]);
  });

  it("keeps completed and abandoned projects available through explicit filters", () => {
    const projects = [
      entry("done", { status: "complete", active: false }),
      entry("stopped", { status: "abandoned", active: false }),
    ];

    expect(
      filterAndSortPortfolioProjects(projects, { status: "complete" }).map(
        (project) => project.slug,
      ),
    ).toEqual(["done"]);
    expect(
      filterAndSortPortfolioProjects(projects, { status: "abandoned" }).map(
        (project) => project.slug,
      ),
    ).toEqual(["stopped"]);
  });

  it("supports evidence filters, search, and deadline sorting", () => {
    const projects = [
      entry("later", {
        name: "Later",
        healthEvidenceState: "measured",
        healthAssessment: "healthy",
        nextIncompleteMilestone: {
          id: "later",
          name: "Later",
          plannedDate: "2026-09-01",
          actualDate: null,
          status: "on-track",
          horizon: "days31to90",
          daysUntil: 37,
          href: "/later",
        },
      }),
      entry("soon", {
        name: "Soon Renovation",
        healthEvidenceState: "partial",
        healthAssessment: "partial",
        nextIncompleteMilestone: {
          id: "soon",
          name: "Soon",
          plannedDate: "2026-08-01",
          actualDate: null,
          status: "at-risk",
          horizon: "next7",
          daysUntil: 6,
          href: "/soon",
        },
      }),
    ];

    expect(
      filterAndSortPortfolioProjects(projects, {
        evidence: "partial",
        query: "renovation",
      }).map((project) => project.slug),
    ).toEqual(["soon"]);
    expect(
      filterAndSortPortfolioProjects(projects, { sort: "deadline" }).map(
        (project) => project.slug,
      ),
    ).toEqual(["soon", "later"]);
  });
});

describe("personal and date ordering", () => {
  it("puts dragged projects in the saved order and everything else after them", () => {
    const projects = [entry("alpha"), entry("beta"), entry("gamma")];

    expect(
      filterAndSortPortfolioProjects(projects, {
        sort: "manual",
        manualOrder: ["gamma", "alpha"],
      }).map((project) => project.slug),
    ).toEqual(["gamma", "alpha", "beta"]);
  });

  it("ignores a saved slug that no longer exists", () => {
    const projects = [entry("alpha"), entry("beta")];

    expect(
      filterAndSortPortfolioProjects(projects, {
        sort: "manual",
        manualOrder: ["deleted", "beta"],
      }).map((project) => project.slug),
    ).toEqual(["beta", "alpha"]);
  });

  it("falls back to a stable order when nothing has been arranged", () => {
    const projects = [entry("beta"), entry("alpha")];

    expect(
      filterAndSortPortfolioProjects(projects, { sort: "manual", manualOrder: [] })
        .map((project) => project.slug),
    ).toEqual(["alpha", "beta"]);
  });

  it("sorts by Notion creation date in both directions", () => {
    const projects = [
      entry("older", { notionCreatedTime: "2024-03-01T00:00:00.000Z" }),
      entry("newer", { notionCreatedTime: "2026-01-15T00:00:00.000Z" }),
    ];

    expect(
      filterAndSortPortfolioProjects(projects, { sort: "created-desc" }).map((p) => p.slug),
    ).toEqual(["newer", "older"]);
    expect(
      filterAndSortPortfolioProjects(projects, { sort: "created-asc" }).map((p) => p.slug),
    ).toEqual(["older", "newer"]);
  });

  it("sorts projects with no date to the end in both directions", () => {
    const projects = [
      entry("undated", { notionCreatedTime: null }),
      entry("dated", { notionCreatedTime: "2025-06-01T00:00:00.000Z" }),
    ];

    for (const sort of ["created-desc", "created-asc"] as const) {
      expect(
        filterAndSortPortfolioProjects(projects, { sort }).map((project) => project.slug),
      ).toEqual(["dated", "undated"]);
    }
  });

  it("sorts by latest recorded activity, most recent first", () => {
    const projects = [
      entry("quiet", { latestRecordedActivity: "2026-07-26" }),
      entry("busy", { latestRecordedActivity: "2026-08-05" }),
      entry("silent", { latestRecordedActivity: null }),
    ];

    expect(
      filterAndSortPortfolioProjects(projects, { sort: "activity-desc" }).map((p) => p.slug),
    ).toEqual(["busy", "quiet", "silent"]);
  });
});
