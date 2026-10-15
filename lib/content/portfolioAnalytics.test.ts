import { describe, expect, it, vi } from "vitest";
import type {
  Budget,
  Checklist,
  DrawingSetEntry,
  MarkupEntry,
  MeetingNote,
  PermitEntry,
  ProjectDetails,
  ProjectMeta,
  ReviewFrontmatter,
  Schedule,
} from "@/lib/schema";
import type { Project } from "./projects";
import { filterAndSortPortfolioProjects } from "@/components/portfolioFilters";
import {
  buildPortfolioSnapshot,
  type PortfolioReaders,
  type ProgressLogRecord,
  type ReviewRecord,
} from "./portfolioAnalytics";

interface FixtureData {
  schedule?: Schedule;
  budget?: Budget;
  permits?: PermitEntry[];
  codeCompliance?: Checklist | null;
  qaqc?: Checklist | null;
  reviews?: ReviewRecord[];
  markups?: MarkupEntry[];
  drawings?: DrawingSetEntry[];
  progressLogs?: ProgressLogRecord[];
  meetings?: MeetingNote[];
  details?: ProjectDetails;
}

const EMPTY_DETAILS: ProjectDetails = {
  client_name: "",
  client_contacts: [],
  address: "",
  scope: "",
  project_type: "",
  team: [],
  fee: null,
  fee_currency: "USD",
  fee_notes: "",
  phases: [],
  contract_link_or_path: "",
};

function createEmptyProjectMeta(
  name: string,
  status: ProjectMeta["status"] = "in-progress",
): ProjectMeta {
  return {
    name,
    address: "",
    client: "",
    status,
    building_type: null,
    occupancy_group: [],
    start_date: null,
    team: [],
    dropbox_path: null,
    notion_page_id: null,
    client_id: null,
    content_location: "local",
    content_migrated_at: null,
  };
}

function project(
  slug: string,
  name: string,
  status: Project["meta"]["status"] = "in-progress",
  links: { notion?: boolean; dropbox?: boolean } = {},
): Project {
  return {
    slug,
    meta: {
      ...createEmptyProjectMeta(name, status),
      notion_page_id: links.notion ? `notion-${slug}` : null,
      dropbox_path: links.dropbox ? `Projects/${slug}` : null,
    },
  };
}

function milestone(
  id: string,
  planned_date: string,
  actual_date: string | null = null,
): Schedule["milestones"][number] {
  return {
    id,
    name: `Milestone ${id}`,
    planned_date,
    actual_date,
    notion_event_id: null,
  };
}

function checklist(statuses: Array<"pending" | "in-progress" | "complete" | "n/a" | "flagged">): Checklist {
  return {
    checklist_id: "fixture",
    items: statuses.map((status, index) => ({
      id: `item-${index}`,
      description: `Item ${index}`,
      code_refs: [],
      discipline: "architectural",
      status,
      checked_by: null,
      checked_date: null,
      evidence: [],
    })),
  };
}

function review(date: string, status: ReviewFrontmatter["status"] = "open"): ReviewRecord {
  return {
    slug: `review-${date}`,
    contentHtml: String(),
    frontmatter: {
      date,
      type: "review",
      discipline: "architectural",
      status,
      related_markups: [],
      related_code_sections: [],
    },
  };
}

function makeReaders(
  projects: Project[],
  fixtures: Record<string, FixtureData> = {},
): PortfolioReaders {
  const data = (slug: string) => fixtures[slug] ?? {};
  return {
    getAllProjects: vi.fn(() => projects),
    getProject: vi.fn((slug) => projects.find((entry) => entry.slug === slug) as Project),
    getSchedule: vi.fn((slug) => data(slug).schedule ?? { milestones: [] }),
    getBudget: vi.fn((slug) => data(slug).budget ?? { categories: [] }),
    getPermits: vi.fn((slug) => data(slug).permits ?? []),
    getChecklist: vi.fn((slug) => data(slug).codeCompliance ?? null),
    getQaqcChecklist: vi.fn((slug) => data(slug).qaqc ?? null),
    getReviews: vi.fn((slug) => data(slug).reviews ?? []),
    getMarkupIndex: vi.fn((slug) => data(slug).markups ?? []),
    getDrawingIndex: vi.fn((slug) => data(slug).drawings ?? []),
    getProgressLog: vi.fn((slug) => data(slug).progressLogs ?? []),
    getMeetingNotes: vi.fn((slug) => data(slug).meetings ?? []),
    getProjectDetails: vi.fn((slug) => data(slug).details ?? EMPTY_DETAILS),
  };
}

describe("portfolio analytics", () => {
  it("excludes only the administrative record and reads each source once per included project", () => {
    const readers = makeReaders([
      project("example-project-18", "example-record-17"),
      project("admin-office", "Admin Office Renovation"),
    ]);

    const snapshot = buildPortfolioSnapshot(readers, "2026-07-26");

    expect(snapshot.projects.map((entry) => entry.slug)).toEqual(["admin-office"]);
    expect(readers.getSchedule).toHaveBeenCalledTimes(1);
    expect(readers.getBudget).toHaveBeenCalledTimes(1);
    expect(readers.getPermits).toHaveBeenCalledTimes(1);
    expect(readers.getReviews).toHaveBeenCalledTimes(1);
  });

  it("keeps all statuses in the portfolio distribution but only in-progress work in active KPIs", () => {
    const readers = makeReaders([
      project("active", "Active", "in-progress"),
      project("future", "Future", "not-started"),
      project("done", "Done", "complete"),
      project("abandoned", "Abandoned", "abandoned"),
    ]);

    const snapshot = buildPortfolioSnapshot(readers, "2026-07-26");

    expect(snapshot.statusDistribution).toEqual({
      "not-started": 1,
      "in-progress": 1,
      complete: 1,
      abandoned: 1,
    });
    expect(snapshot.kpis.activeProjects).toBe(1);
    expect(snapshot.activeProjects.map((entry) => entry.slug)).toEqual(["active"]);
  });

  it("labels sufficient deduction-free evidence as measured healthy", () => {
    const readers = makeReaders([project("healthy", "Healthy", "in-progress")], {
      healthy: {
        schedule: { milestones: [milestone("later", "2026-12-01")] },
        budget: {
          categories: [{
            name: "Design",
            budgeted: 100,
            committed: 40,
            actual: 50,
            currency: "USD",
          }],
        },
        permits: [{
          permit_type: "Building",
          status: "approved",
          submitted_date: "2026-06-01",
          approved_date: "2026-07-01",
          permit_number: "P-1",
        }],
      },
    });

    const [snapshot] = buildPortfolioSnapshot(readers, "2026-07-26").projects;

    expect(snapshot.populatedHealthAreas).toEqual(["schedule", "budget", "permits"]);
    expect(snapshot.healthEvidenceState).toBe("measured");
    expect(snapshot.healthAssessment).toBe("healthy");
    expect(snapshot.healthScore).toBe(100);
    expect(snapshot.healthLabel).toBe("Measured healthy");
  });

  it("never treats an evidence-free 100 as measured health", () => {
    const [snapshot] = buildPortfolioSnapshot(
      makeReaders([project("empty", "Empty")]),
      "2026-07-26",
    ).projects;

    expect(snapshot.healthScore).toBe(100);
    expect(snapshot.healthEvidenceState).toBe("unmeasured");
    expect(snapshot.healthAssessment).toBe("unmeasured");
    expect(snapshot.healthLabel).toBe("Health unmeasured");
    expect(snapshot.healthExplanation).toContain("not treated as a reliable health result");
  });

  it("labels one or two populated health areas as partial even when a factual issue exists", () => {
    const readers = makeReaders([project("partial", "Partial")], {
      partial: {
        schedule: { milestones: [milestone("late", "2026-07-20")] },
        reviews: [review("2026-07-25", "resolved")],
      },
    });

    const [snapshot] = buildPortfolioSnapshot(readers, "2026-07-26").projects;

    expect(snapshot.healthEvidenceState).toBe("partial");
    expect(snapshot.healthAssessment).toBe("partial");
    expect(snapshot.urgency.overdueMilestones).toBe(1);
    expect(snapshot.attentionReasons[0]).toMatchObject({
      code: "overdue-milestones",
      category: "performance",
      rank: 1,
    });
  });

  it("uses exact, inclusive milestone horizon boundaries and a fixed date", () => {
    const schedule: Schedule = {
      milestones: [
        milestone("overdue", "2026-07-25"),
        milestone("today", "2026-07-26"),
        milestone("day7", "2026-08-02"),
        milestone("day8", "2026-08-03"),
        milestone("day30", "2026-08-25"),
        milestone("day31", "2026-08-26"),
        milestone("day90", "2026-10-24"),
        milestone("day91", "2026-10-25"),
        milestone("complete", "2026-07-01", "2026-06-30"),
      ],
    };
    const readers = makeReaders([project("horizons", "Horizons")], {
      horizons: { schedule },
    });

    const portfolio = buildPortfolioSnapshot(readers, "2026-07-26");
    const [snapshot] = portfolio.projects;

    expect(snapshot.milestoneHorizons).toEqual({
      overdue: 1,
      next7: 2,
      days8to30: 2,
      days31to90: 2,
      later: 1,
    });
    expect(snapshot.nextIncompleteMilestone?.id).toBe("overdue");
    expect(snapshot.nextUpcomingMilestone?.id).toBe("today");
    expect(portfolio.upcomingMilestones.map((entry) => entry.id)).toEqual(["today"]);
    expect(buildPortfolioSnapshot(readers, "2026-07-27").projects[0].milestoneHorizons)
      .not.toEqual(snapshot.milestoneHorizons);
  });

  it("orders all factual reasons by the documented severity without hiding lower reasons", () => {
    const readers = makeReaders(
      [project("risk", "Risk", "in-progress")],
      {
        risk: {
          schedule: {
            milestones: [
              milestone("late", "2026-07-01"),
              milestone("soon", "2026-08-01"),
            ],
          },
          budget: {
            categories: [
              { name: "Over", budgeted: 100, committed: 100, actual: 120, currency: "USD" },
              { name: "Warn", budgeted: 100, committed: 90, actual: 90, currency: "USD" },
            ],
          },
          permits: [{
            permit_type: "Building",
            status: "under-review",
            submitted_date: "2026-06-01",
            approved_date: null,
            permit_number: null,
          }],
          reviews: [review("2026-06-01")],
          codeCompliance: checklist(["flagged"]),
          qaqc: checklist(["pending"]),
        },
      },
    );

    const [snapshot] = buildPortfolioSnapshot(readers, "2026-07-26").projects;

    expect(snapshot.attentionReasons.map((reason) => reason.rank)).toEqual([
      1, 2, 3, 3, 4, 5, 6, 6, 9, 9,
    ]);
    expect(snapshot.attentionPriority).toBe("urgent");
    expect(snapshot.healthEvidenceState).toBe("measured");
    expect(snapshot.healthAssessment).toBe("needs-attention");
  });

  it("sorts the review queue deterministically by rank, same-rank reason count, and name", () => {
    const readers = makeReaders(
      [
        project("beta", "Beta"),
        project("alpha", "Alpha"),
        project("gamma", "Gamma"),
      ],
      {
        beta: { schedule: { milestones: [milestone("late", "2026-07-01")] } },
        alpha: { schedule: { milestones: [milestone("late", "2026-07-01")] } },
        gamma: {
          schedule: { milestones: [milestone("late", "2026-07-01")] },
          budget: {
            categories: [
              { name: "Over", budgeted: 1, committed: 1, actual: 2, currency: "USD" },
            ],
          },
        },
      },
    );

    const snapshot = buildPortfolioSnapshot(readers, "2026-07-26");

    expect(snapshot.reviewQueue.map((entry) => entry.slug)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
  });

  it("uses only authored record dates for latest activity", () => {
    const readers = makeReaders([project("activity", "Activity")], {
      activity: {
        schedule: {
          milestones: [
            milestone("done", "2026-05-10", "2026-05-12"),
            milestone("future", "2027-01-01"),
          ],
        },
        permits: [{
          permit_type: "Building",
          status: "approved",
          submitted_date: "2026-03-01",
          approved_date: "2026-04-01",
          permit_number: null,
        }],
        progressLogs: [{
          slug: "log",
          contentHtml: String(),
          frontmatter: {
            date: "2026-06-15",
            author: "Alex",
            type: "progress-log",
            tags: [],
          },
        }],
        reviews: [review("2026-07-05", "resolved")],
        markups: [{
          sheet: "A-101",
          revision: 1,
          date: "2026-07-10",
          discipline: "architectural",
          file: "markup.pdf",
          status: "addressed",
          related_code_sections: [],
        }],
        meetings: [{
          id: "meeting",
          title: "Meeting",
          meeting_type: "Coordination",
          meeting_status: "completed",
          date: "2026-07-20",
          start_time: "09:00",
          end_time: "10:00",
          timezone: "America/Chicago",
          attendees: [],
          objective: "",
          preparation: [],
          agenda_items: [],
          raw_notes: "",
          summary: "",
          decisions: [],
          action_items: [],
          open_questions: [],
          decision_records: [],
          blocking_questions: [],
          impacts: [],
          sources: [],
        }],
      },
    });

    const [snapshot] = buildPortfolioSnapshot(readers, "2026-07-26").projects;
    const [empty] = buildPortfolioSnapshot(
      makeReaders([project("none", "None")]),
      "2026-07-26",
    ).projects;

    expect(snapshot.latestRecordedActivity).toBe("2026-07-20");
    expect(empty.latestRecordedActivity).toBeNull();
  });

  it("handles an empty portfolio and zero denominators without NaN or Infinity", () => {
    const snapshot = buildPortfolioSnapshot(makeReaders([]), "2026-07-26");

    expect(snapshot.projects).toEqual([]);
    expect(snapshot.kpis).toEqual({
      totalProjects: 0,
      activeProjects: 0,
      activeNeedsAttention: 0,
      overdueMilestones: 0,
      dueWithin30Days: 0,
      activeUnmeasuredHealth: 0,
    });
    expect(snapshot.sourceCoverage.every((area) => area.percent === 0)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/NaN|Infinity/);
  });

  it("calculates data-source coverage from populated records and confirmed links", () => {
    const readers = makeReaders(
      [
        project("linked", "Linked", "in-progress", { notion: true, dropbox: true }),
        project("empty", "Empty"),
      ],
      {
        linked: {
          schedule: { milestones: [milestone("one", "2026-12-01")] },
          details: { ...EMPTY_DETAILS, scope: "Renovation" },
        },
      },
    );
    const snapshot = buildPortfolioSnapshot(readers, "2026-07-26");
    const coverage = Object.fromEntries(
      snapshot.sourceCoverage.map((area) => [area.area, area]),
    );

    expect(coverage.schedule).toMatchObject({ populatedProjects: 1, totalProjects: 2, percent: 50 });
    expect(coverage.projectDetails).toMatchObject({ populatedProjects: 1, percent: 50 });
    expect(coverage.notionLink).toMatchObject({ populatedProjects: 1, percent: 50 });
    expect(coverage.budget).toMatchObject({ populatedProjects: 0, percent: 0 });
  });

  it("builds honest visualization distributions from active data", () => {
    const readers = makeReaders(
      [
        project("measured", "Measured"),
        project("partial", "Partial"),
        project("unmeasured", "Unmeasured"),
        project("complete", "Complete", "complete"),
      ],
      {
        measured: {
          schedule: { milestones: [milestone("later", "2027-01-01")] },
          budget: {
            categories: [
              { name: "Fee", budgeted: 1, committed: 0, actual: 0, currency: "USD" },
            ],
          },
          permits: [{
            permit_type: "Building",
            status: "approved",
            submitted_date: null,
            approved_date: "2026-01-01",
            permit_number: null,
          }],
        },
        partial: { reviews: [review("2026-07-01", "resolved")] },
      },
    );
    const snapshot = buildPortfolioSnapshot(readers, "2026-07-26");

    expect(snapshot.activeHealthDistribution).toEqual({
      unmeasured: 1,
      partial: 1,
      measuredHealthy: 1,
      measuredNeedsAttention: 0,
    });
    expect(snapshot.statusDistribution.complete).toBe(1);
    expect(snapshot.attentionCategoryDistribution).toEqual({
      performance: 0,
      planning: 2,
      evidence: 1,
      integration: 6,
    });
  });

  it("generates a deterministic factual briefing", () => {
    const readers = makeReaders([project("active", "Active")], {
      active: { schedule: { milestones: [milestone("next", "2026-08-01")] } },
    });

    const first = buildPortfolioSnapshot(readers, "2026-07-26").briefing;
    const second = buildPortfolioSnapshot(readers, "2026-07-26").briefing;

    expect(first).toBe(second);
    expect(first).toContain("1 active project");
    expect(first).toContain("Next recorded deadline: Active — Milestone next on 2026-08-01.");
    expect(first).toContain("partial or unavailable health evidence");
  });

  it("applies the active default, explicit status/evidence filters, search, and stable sorts", () => {
    const readers = makeReaders(
      [
        project("zeta", "Zeta Active"),
        project("alpha", "Alpha Active"),
        project("done", "Done", "complete"),
      ],
      {
        zeta: { schedule: { milestones: [milestone("later", "2026-12-01")] } },
        alpha: { schedule: { milestones: [milestone("soon", "2026-08-01")] } },
      },
    );
    const projects = buildPortfolioSnapshot(readers, "2026-07-26").projects;

    expect(filterAndSortPortfolioProjects(projects).map((entry) => entry.slug)).toEqual([
      "alpha",
      "zeta",
    ]);
    expect(
      filterAndSortPortfolioProjects(projects, { status: "complete" }).map((entry) => entry.slug),
    ).toEqual(["done"]);
    expect(
      filterAndSortPortfolioProjects(projects, { evidence: "partial" }).map((entry) => entry.slug),
    ).toEqual(["alpha", "zeta"]);
    expect(
      filterAndSortPortfolioProjects(projects, { status: "all", query: "done" }).map(
        (entry) => entry.slug,
      ),
    ).toEqual(["done"]);
    expect(
      filterAndSortPortfolioProjects(projects, { sort: "name" }).map((entry) => entry.name),
    ).toEqual(["Alpha Active", "Zeta Active"]);
    expect(
      filterAndSortPortfolioProjects(projects, { sort: "deadline" }).map((entry) => entry.slug),
    ).toEqual(["alpha", "zeta"]);
  });
});
