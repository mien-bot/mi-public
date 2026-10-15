import type {
  Budget,
  Checklist,
  DrawingPhase,
  DrawingSetEntry,
  MarkupEntry,
  MeetingNote,
  PermitEntry,
  ProgressLogFrontmatter,
  ProjectDetails,
  ProjectStatus,
  ReviewFrontmatter,
  Schedule,
} from "@/lib/schema";
import { getProjectMapSnapshot, type ProjectMap } from "@/lib/notion/projectMap";
import { isAgentWorkspaceConfirmed } from "./agentWorkspace";
import { computeProjectHealth, explainProjectHealth, type ProjectHealth } from "./health";
import { computeBudgetStatus } from "./status";
import { getChecklistCompletion, type ChecklistCompletion } from "./completion";
import { isActiveProjectStatus, isPortfolioProject } from "./projectVisibility";
import {
  getAllProjects,
  getBudget,
  getChecklist,
  getDrawingIndex,
  getMarkupIndex,
  getPermits,
  getProgressLog,
  getProject,
  getQaqcChecklist,
  getReviews,
  getSchedule,
  type Project,
} from "./projects";
import { getMeetingNotes, getProjectDetails } from "./projectWorkspace";
import type { ProjectUrgency } from "./urgency";

const MS_PER_DAY = 86_400_000;
const HEALTH_AREA_COUNT_FOR_MEASURED = 3;
const STALE_AFTER_DAYS = 30;

export const HEALTH_TRACKING_AREAS = [
  "schedule",
  "budget",
  "permits",
  "codeCompliance",
  "qaqc",
  "reviews",
] as const;

export const TRACKING_AREAS = [
  ...HEALTH_TRACKING_AREAS,
  "drawings",
  "markups",
  "progressLogs",
  "meetings",
  "projectDetails",
  "notionLink",
  "dropboxLink",
] as const;

export type HealthTrackingArea = (typeof HEALTH_TRACKING_AREAS)[number];
export type TrackingArea = (typeof TRACKING_AREAS)[number];
export type HealthEvidenceState = "unmeasured" | "partial" | "measured";
export type HealthAssessment = "unmeasured" | "partial" | "healthy" | "needs-attention";
export type AttentionCategory = "performance" | "planning" | "evidence" | "integration";
export type AttentionPriority = "urgent" | "high" | "review" | "low" | "none";
export type MilestoneHorizon = "overdue" | "next7" | "days8to30" | "days31to90" | "later";

export const TRACKING_AREA_LABELS: Record<TrackingArea, string> = {
  schedule: "Schedule",
  budget: "Budget",
  permits: "Permits",
  codeCompliance: "Code compliance",
  qaqc: "QA/QC",
  reviews: "Reviews",
  drawings: "Drawings",
  markups: "Markups",
  progressLogs: "Progress logs",
  meetings: "Meetings",
  projectDetails: "Project details",
  notionLink: "Notion link",
  dropboxLink: "Dropbox link",
};

export interface ReviewRecord {
  slug: string;
  frontmatter: ReviewFrontmatter;
  contentHtml: string;
}

export interface ProgressLogRecord {
  slug: string;
  frontmatter: ProgressLogFrontmatter;
  contentHtml: string;
}

export interface PortfolioReaders {
  getAllProjects: () => Project[];
  getProject: (slug: string) => Project;
  getSchedule: (slug: string) => Schedule;
  getBudget: (slug: string) => Budget;
  getPermits: (slug: string) => PermitEntry[];
  getChecklist: (slug: string) => Checklist | null;
  getQaqcChecklist: (slug: string) => Checklist | null;
  getReviews: (slug: string) => ReviewRecord[];
  getMarkupIndex: (slug: string) => MarkupEntry[];
  getDrawingIndex: (slug: string) => DrawingSetEntry[];
  getProgressLog: (slug: string) => ProgressLogRecord[];
  getMeetingNotes: (slug: string) => MeetingNote[];
  getProjectDetails: (slug: string) => ProjectDetails;
  /** Optional so existing fixtures stay valid; defaults to the committed Notion snapshot. */
  getProjectMap?: () => ProjectMap | null;
}

export const defaultPortfolioReaders: PortfolioReaders = {
  getAllProjects,
  getProject,
  getSchedule,
  getBudget,
  getPermits,
  getChecklist,
  getQaqcChecklist,
  getReviews,
  getMarkupIndex,
  getDrawingIndex,
  getProgressLog,
  getMeetingNotes,
  getProjectDetails,
};

export interface ProjectAnalysisRecords {
  project: Project;
  schedule: Schedule;
  budget: Budget;
  permits: PermitEntry[];
  codeCompliance: Checklist | null;
  qaqc: Checklist | null;
  reviews: ReviewRecord[];
  markups: MarkupEntry[];
  drawings: DrawingSetEntry[];
  progressLogs: ProgressLogRecord[];
  meetings: MeetingNote[];
  details: ProjectDetails;
}

export interface MilestoneAnalysis {
  id: string;
  name: string;
  plannedDate: string;
  actualDate: string | null;
  status: "complete" | "overdue" | "at-risk" | "on-track";
  horizon: MilestoneHorizon | null;
  daysUntil: number | null;
  href: string;
}

export interface PermitAgingSnapshot {
  permitType: string;
  status: PermitEntry["status"];
  submittedDate: string;
  daysOpen: number;
  stale: boolean;
}

export interface AttentionReason {
  code:
    | "overdue-milestones"
    | "over-budget"
    | "stale-permits"
    | "stale-reviews"
    | "at-risk-milestones"
    | "budget-warning"
    | "code-checklist"
    | "qaqc"
    | "no-upcoming-milestone"
    | "unmeasured-health"
    | "missing-notion"
    | "missing-dropbox"
    | "agent-workspace-unconfirmed";
  category: AttentionCategory;
  rank: number;
  label: string;
  source: string;
  /** Only set for agent-workspace-unconfirmed — where clicking the badge should navigate. */
  href?: string;
}

export interface ProjectPortfolioSnapshot {
  slug: string;
  name: string;
  status: ProjectStatus;
  active: boolean;
  client: string;
  address: string;
  buildingType: string | null;
  healthScore: number;
  healthBucket: ProjectHealth["bucket"];
  healthEvidenceState: HealthEvidenceState;
  healthAssessment: HealthAssessment;
  healthLabel: string;
  healthExplanation: string;
  urgency: ProjectUrgency;
  nextIncompleteMilestone: MilestoneAnalysis | null;
  nextUpcomingMilestone: MilestoneAnalysis | null;
  overdueMilestones: MilestoneAnalysis[];
  atRiskMilestones: MilestoneAnalysis[];
  milestoneHorizons: Record<MilestoneHorizon, number>;
  latestRecordedActivity: string | null;
  /**
   * Notion's created_time for the linked Studio Projects page, from the committed
   * notion/project-map.json snapshot. Null when the project has no confirmed link or the
   * snapshot hasn't been refreshed here -- never inferred from the filesystem, whose
   * timestamps reflect Dropbox sync rather than when the project began.
   */
  notionCreatedTime: string | null;
  populatedHealthAreas: HealthTrackingArea[];
  populatedTrackingAreas: TrackingArea[];
  unpopulatedTrackingAreas: TrackingArea[];
  trackingCoverage: {
    populated: number;
    total: number;
  };
  notionLinkState: "confirmed" | "missing";
  dropboxLinkState: "confirmed" | "missing";
  budgetWarningCount: number;
  overBudgetCount: number;
  permitAging: PermitAgingSnapshot[];
  staleReviewCount: number;
  codeChecklist: ChecklistCompletion;
  qaqc: ChecklistCompletion;
  markup: {
    total: number;
    open: number;
    addressed: number;
    superseded: number;
    percentResolved: number;
  };
  drawingCount: number;
  populatedDrawingPhases: DrawingPhase[];
  progressLogCount: number;
  meetingNoteCount: number;
  attentionReasons: AttentionReason[];
  attentionPriority: AttentionPriority;
  attentionRank: number;
}

export interface PortfolioSourceCoverage {
  area: TrackingArea;
  label: string;
  populatedProjects: number;
  totalProjects: number;
  percent: number;
}

export interface PortfolioSnapshot {
  today: string;
  generatedFrom: "local-authored-records";
  projects: ProjectPortfolioSnapshot[];
  activeProjects: ProjectPortfolioSnapshot[];
  reviewQueue: ProjectPortfolioSnapshot[];
  kpis: {
    totalProjects: number;
    activeProjects: number;
    activeNeedsAttention: number;
    overdueMilestones: number;
    dueWithin30Days: number;
    activeUnmeasuredHealth: number;
  };
  statusDistribution: Record<ProjectStatus, number>;
  activeHealthDistribution: {
    unmeasured: number;
    partial: number;
    measuredHealthy: number;
    measuredNeedsAttention: number;
  };
  scheduleOutlook: Record<MilestoneHorizon, number>;
  attentionCategoryDistribution: Record<AttentionCategory, number>;
  attentionReasonDistribution: Array<{ code: AttentionReason["code"]; label: string; count: number }>;
  sourceCoverage: PortfolioSourceCoverage[];
  upcomingMilestones: Array<MilestoneAnalysis & { projectSlug: string; projectName: string }>;
  briefing: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function todayToDateOnly(today: Date | string = new Date()): string {
  if (typeof today === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
      throw new Error(`Expected today as YYYY-MM-DD, received "${today}".`);
    }
    return today;
  }
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

function dateOnlyDayNumber(value: string): number {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function daysBetweenDateOnly(from: string, to: string): number {
  return dateOnlyDayNumber(to) - dateOnlyDayNumber(from);
}

export function classifyMilestone(
  milestone: Schedule["milestones"][number],
  today: string,
): MilestoneAnalysis {
  if (milestone.actual_date) {
    return {
      id: milestone.id,
      name: milestone.name,
      plannedDate: milestone.planned_date,
      actualDate: milestone.actual_date,
      status: "complete",
      horizon: null,
      daysUntil: null,
      href: "",
    };
  }

  const daysUntil = daysBetweenDateOnly(today, milestone.planned_date);
  const horizon: MilestoneHorizon =
    daysUntil < 0
      ? "overdue"
      : daysUntil <= 7
        ? "next7"
        : daysUntil <= 30
          ? "days8to30"
          : daysUntil <= 90
            ? "days31to90"
            : "later";

  return {
    id: milestone.id,
    name: milestone.name,
    plannedDate: milestone.planned_date,
    actualDate: null,
    status: daysUntil < 0 ? "overdue" : daysUntil <= 14 ? "at-risk" : "on-track",
    horizon,
    daysUntil,
    href: "",
  };
}

function countByStatus(checklist: Checklist | null): ChecklistCompletion {
  return getChecklistCompletion(checklist);
}

function meaningfulDetails(details: ProjectDetails): boolean {
  return Boolean(
    details.client_name ||
      details.client_contacts.length ||
      details.address ||
      details.scope ||
      details.project_type ||
      details.team.length ||
      details.fee !== null ||
      details.fee_notes ||
      details.contract_link_or_path,
  );
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function attentionPriorityForRank(rank: number): AttentionPriority {
  if (rank <= 3) return "urgent";
  if (rank <= 6) return "high";
  if (rank <= 8) return "review";
  if (rank === 9) return "low";
  return "none";
}

function compareProjectsByAttention(
  a: ProjectPortfolioSnapshot,
  b: ProjectPortfolioSnapshot,
): number {
  return (
    a.attentionRank - b.attentionRank ||
    b.attentionReasons.length - a.attentionReasons.length ||
    a.name.localeCompare(b.name, "en") ||
    a.slug.localeCompare(b.slug, "en")
  );
}

function buildAttentionReasons(input: {
  active: boolean;
  urgency: ProjectUrgency;
  codeChecklist: ChecklistCompletion;
  qaqc: ChecklistCompletion;
  hasUpcomingMilestone: boolean;
  evidenceState: HealthEvidenceState;
  notionLinked: boolean;
  dropboxLinked: boolean;
  agentWorkspaceConfirmed: boolean;
  slug: string;
}): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  const add = (
    code: AttentionReason["code"],
    category: AttentionCategory,
    rank: number,
    label: string,
    source: string,
    href?: string,
  ) => reasons.push({ code, category, rank, label, source, href });

  if (input.urgency.overdueMilestones) {
    add(
      "overdue-milestones",
      "performance",
      1,
      `${countLabel(input.urgency.overdueMilestones, "overdue milestone", "overdue milestones")}`,
      "schedule/schedule.yaml",
    );
  }
  if (input.urgency.overBudgetCategories) {
    add(
      "over-budget",
      "performance",
      2,
      `${countLabel(input.urgency.overBudgetCategories, "over-budget category", "over-budget categories")}`,
      "budget/budget.yaml",
    );
  }
  if (input.urgency.stalePermits) {
    add(
      "stale-permits",
      "performance",
      3,
      `${countLabel(input.urgency.stalePermits, "permit stale over 30 days", "permits stale over 30 days")}`,
      "permits/status.yaml",
    );
  }
  if (input.urgency.staleReviews) {
    add(
      "stale-reviews",
      "performance",
      3,
      `${countLabel(input.urgency.staleReviews, "review stale over 30 days", "reviews stale over 30 days")}`,
      "reviews/*.md",
    );
  }
  if (input.urgency.atRiskMilestones) {
    add(
      "at-risk-milestones",
      "performance",
      4,
      `${countLabel(input.urgency.atRiskMilestones, "milestone due within 14 days", "milestones due within 14 days")}`,
      "schedule/schedule.yaml",
    );
  }
  if (input.urgency.warningBudgetCategories) {
    add(
      "budget-warning",
      "performance",
      5,
      `${countLabel(input.urgency.warningBudgetCategories, "budget category at warning level", "budget categories at warning level")}`,
      "budget/budget.yaml",
    );
  }
  const openCode =
    input.codeChecklist.pending +
    input.codeChecklist.inProgress +
    input.codeChecklist.flagged;
  if (openCode) {
    add(
      "code-checklist",
      "performance",
      6,
      `${countLabel(openCode, "code-checklist item incomplete or flagged", "code-checklist items incomplete or flagged")}`,
      "checklists/code-compliance.yaml",
    );
  }
  const openQaqc = input.qaqc.pending + input.qaqc.inProgress + input.qaqc.flagged;
  if (openQaqc) {
    add(
      "qaqc",
      "performance",
      6,
      `${countLabel(openQaqc, "QA/QC item incomplete or flagged", "QA/QC items incomplete or flagged")}`,
      "qaqc/qaqc.yaml",
    );
  }
  if (input.active && !input.hasUpcomingMilestone) {
    add(
      "no-upcoming-milestone",
      "planning",
      7,
      "No upcoming milestone",
      "schedule/schedule.yaml",
    );
  }
  if (input.active && input.evidenceState === "unmeasured") {
    add(
      "unmeasured-health",
      "evidence",
      8,
      "Health unmeasured; no populated health-related records",
      "schedule, budget, permits, checklists, QA/QC, and reviews",
    );
  }
  if (input.active && !input.notionLinked) {
    add(
      "missing-notion",
      "integration",
      9,
      "Missing confirmed Notion link",
      "project.yaml notion_page_id",
    );
  }
  if (input.active && !input.dropboxLinked) {
    add(
      "missing-dropbox",
      "integration",
      9,
      "Missing confirmed Dropbox link",
      "project.yaml dropbox_path",
    );
  }
  if (input.active && input.dropboxLinked && !input.agentWorkspaceConfirmed) {
    add(
      "agent-workspace-unconfirmed",
      "integration",
      9,
      "Agent workspace not set up",
      "Files & Contracts → Repair/Refresh Agent Workspace",
      `/projects/${input.slug}/files`,
    );
  }

  return reasons.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, "en"));
}

export function readProjectAnalysisRecords(
  project: Project,
  readers: PortfolioReaders = defaultPortfolioReaders,
): ProjectAnalysisRecords {
  const slug = project.slug;
  return {
    project,
    schedule: readers.getSchedule(slug),
    budget: readers.getBudget(slug),
    permits: readers.getPermits(slug),
    codeCompliance: readers.getChecklist(slug),
    qaqc: readers.getQaqcChecklist(slug),
    reviews: readers.getReviews(slug),
    markups: readers.getMarkupIndex(slug),
    drawings: readers.getDrawingIndex(slug),
    progressLogs: readers.getProgressLog(slug),
    meetings: readers.getMeetingNotes(slug),
    details: readers.getProjectDetails(slug),
  };
}

export function buildProjectPortfolioSnapshot(
  records: ProjectAnalysisRecords,
  todayValue: Date | string,
): ProjectPortfolioSnapshot {
  const today = todayToDateOnly(todayValue);
  const { project } = records;
  const active = isActiveProjectStatus(project.meta.status);
  const milestones = records.schedule.milestones
    .map((milestone) => ({
      ...classifyMilestone(milestone, today),
      href: `/projects/${project.slug}/schedule`,
    }))
    .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.id.localeCompare(b.id));
  const incomplete = milestones.filter((milestone) => milestone.status !== "complete");
  const nextIncompleteMilestone = incomplete[0] ?? null;
  const nextUpcomingMilestone =
    incomplete.find((milestone) => (milestone.daysUntil ?? -1) >= 0) ?? null;
  const overdueMilestones = incomplete.filter((milestone) => milestone.horizon === "overdue");
  const atRiskMilestones = incomplete.filter((milestone) => milestone.status === "at-risk");

  const budgetStatuses = records.budget.categories.map(computeBudgetStatus);
  const overBudgetCount = budgetStatuses.filter((status) => status === "over").length;
  const budgetWarningCount = budgetStatuses.filter((status) => status === "warning").length;

  const permitAging = records.permits
    .filter(
      (permit) =>
        (permit.status === "submitted" || permit.status === "under-review") &&
        permit.submitted_date,
    )
    .map((permit) => {
      const daysOpen = daysBetweenDateOnly(permit.submitted_date as string, today);
      return {
        permitType: permit.permit_type,
        status: permit.status,
        submittedDate: permit.submitted_date as string,
        daysOpen,
        stale: daysOpen > STALE_AFTER_DAYS,
      };
    });
  const staleReviewCount = records.reviews.filter(
    (review) =>
      (review.frontmatter.status === "open" ||
        review.frontmatter.status === "in-progress") &&
      daysBetweenDateOnly(review.frontmatter.date, today) > STALE_AFTER_DAYS,
  ).length;

  const codeChecklist = countByStatus(records.codeCompliance);
  const qaqc = countByStatus(records.qaqc);
  const urgency: ProjectUrgency = {
    overdueMilestones: overdueMilestones.length,
    atRiskMilestones: atRiskMilestones.length,
    overBudgetCategories: overBudgetCount,
    warningBudgetCategories: budgetWarningCount,
    stalePermits: permitAging.filter((permit) => permit.stale).length,
    incompleteChecklistItems:
      codeChecklist.pending +
      codeChecklist.inProgress +
      qaqc.pending +
      qaqc.inProgress,
    staleReviews: staleReviewCount,
  };
  const health = computeProjectHealth(urgency);

  const populated: Record<TrackingArea, boolean> = {
    schedule: records.schedule.milestones.length > 0,
    budget: records.budget.categories.length > 0,
    permits: records.permits.length > 0,
    codeCompliance: codeChecklist.total > 0,
    qaqc: qaqc.total > 0,
    reviews: records.reviews.length > 0,
    drawings: records.drawings.length > 0,
    markups: records.markups.length > 0,
    progressLogs: records.progressLogs.length > 0,
    meetings: records.meetings.length > 0,
    projectDetails: meaningfulDetails(records.details),
    notionLink: Boolean(project.meta.notion_page_id),
    dropboxLink: Boolean(project.meta.dropbox_path),
  };
  const populatedHealthAreas = HEALTH_TRACKING_AREAS.filter((area) => populated[area]);
  const healthEvidenceState: HealthEvidenceState =
    populatedHealthAreas.length === 0
      ? "unmeasured"
      : populatedHealthAreas.length < HEALTH_AREA_COUNT_FOR_MEASURED
        ? "partial"
        : "measured";
  const hasDeductions = Object.values(urgency).some((count) => count > 0);
  const healthAssessment: HealthAssessment =
    healthEvidenceState === "unmeasured"
      ? "unmeasured"
      : healthEvidenceState === "partial"
        ? "partial"
        : hasDeductions
          ? "needs-attention"
          : "healthy";
  const healthLabel =
    healthAssessment === "unmeasured"
      ? "Health unmeasured"
      : healthAssessment === "partial"
        ? "Partially measured"
        : healthAssessment === "healthy"
          ? "Measured healthy"
          : "Measured · needs attention";
  const evidenceSentence =
    healthEvidenceState === "unmeasured"
      ? "No health-related management records are populated; the deduction model's 100 is not treated as a reliable health result."
      : `${populatedHealthAreas.length} of ${HEALTH_TRACKING_AREAS.length} health-related tracking areas are populated (${healthEvidenceState === "partial" ? "partial evidence" : "measured evidence"}).`;
  const healthExplanation = `${evidenceSentence} ${explainProjectHealth(health)}`;

  const markupTotal = records.markups.length;
  const markupAddressed = records.markups.filter((markup) => markup.status === "addressed").length;
  const populatedTrackingAreas = TRACKING_AREAS.filter((area) => populated[area]);
  const unpopulatedTrackingAreas = TRACKING_AREAS.filter((area) => !populated[area]);
  const datedActivity = [
    ...records.progressLogs.map((entry) => entry.frontmatter.date),
    ...records.reviews.map((entry) => entry.frontmatter.date),
    ...records.markups.map((entry) => entry.date),
    ...records.drawings.map((entry) => entry.date),
    ...records.permits.flatMap((permit) =>
      [permit.submitted_date, permit.approved_date].filter((date): date is string => Boolean(date)),
    ),
    ...records.schedule.milestones
      .map((milestone) => milestone.actual_date)
      .filter((date): date is string => Boolean(date)),
    ...records.meetings.map((meeting) => meeting.date),
  ].sort();
  const latestRecordedActivity = datedActivity.at(-1) ?? null;

  const attentionReasons = buildAttentionReasons({
    active,
    urgency,
    codeChecklist,
    qaqc,
    hasUpcomingMilestone: Boolean(nextUpcomingMilestone),
    evidenceState: healthEvidenceState,
    notionLinked: populated.notionLink,
    dropboxLinked: populated.dropboxLink,
    agentWorkspaceConfirmed: populated.dropboxLink
      ? isAgentWorkspaceConfirmed(project.meta.dropbox_path)
      : true,
    slug: project.slug,
  });
  const attentionRank = attentionReasons[0]?.rank ?? Number.MAX_SAFE_INTEGER;

  return {
    slug: project.slug,
    name: project.meta.name,
    status: project.meta.status,
    active,
    client: project.meta.client,
    address: project.meta.address,
    buildingType: project.meta.building_type,
    healthScore: health.score,
    healthBucket: health.bucket,
    healthEvidenceState,
    healthAssessment,
    healthLabel,
    healthExplanation,
    urgency,
    nextIncompleteMilestone,
    nextUpcomingMilestone,
    overdueMilestones,
    atRiskMilestones,
    milestoneHorizons: {
      overdue: incomplete.filter((milestone) => milestone.horizon === "overdue").length,
      next7: incomplete.filter((milestone) => milestone.horizon === "next7").length,
      days8to30: incomplete.filter((milestone) => milestone.horizon === "days8to30").length,
      days31to90: incomplete.filter((milestone) => milestone.horizon === "days31to90").length,
      later: incomplete.filter((milestone) => milestone.horizon === "later").length,
    },
    latestRecordedActivity,
    // Filled in by buildPortfolioSnapshot, which reads the Notion map once for the whole
    // portfolio rather than re-reading it per project here.
    notionCreatedTime: null,
    populatedHealthAreas,
    populatedTrackingAreas,
    unpopulatedTrackingAreas,
    trackingCoverage: {
      populated: populatedTrackingAreas.length,
      total: TRACKING_AREAS.length,
    },
    notionLinkState: populated.notionLink ? "confirmed" : "missing",
    dropboxLinkState: populated.dropboxLink ? "confirmed" : "missing",
    budgetWarningCount,
    overBudgetCount,
    permitAging,
    staleReviewCount,
    codeChecklist,
    qaqc,
    markup: {
      total: markupTotal,
      open: records.markups.filter((markup) => markup.status === "open").length,
      addressed: markupAddressed,
      superseded: records.markups.filter((markup) => markup.status === "superseded").length,
      percentResolved: markupTotal === 0 ? 0 : Math.round((markupAddressed / markupTotal) * 100),
    },
    drawingCount: records.drawings.length,
    populatedDrawingPhases: (["sd", "dd", "cd", "ca"] as DrawingPhase[]).filter((phase) =>
      records.drawings.some((drawing) => drawing.phase === phase),
    ),
    progressLogCount: records.progressLogs.length,
    meetingNoteCount: records.meetings.length,
    attentionReasons,
    attentionPriority: attentionPriorityForRank(attentionRank),
    attentionRank,
  };
}

export function generatePortfolioBriefing(snapshot: Omit<PortfolioSnapshot, "briefing">): string {
  const active = snapshot.activeProjects;
  const urgent = active.filter((project) => project.attentionPriority === "urgent");
  const noUpcoming = active.filter((project) => !project.nextUpcomingMilestone);
  const unmeasured = active.filter((project) => project.healthEvidenceState === "unmeasured");
  const integrationGaps = active.filter(
    (project) =>
      project.notionLinkState === "missing" || project.dropboxLinkState === "missing",
  );
  const trackingGaps = active.filter(
    (project) => project.healthEvidenceState !== "measured",
  );
  const nextDeadline = snapshot.upcomingMilestones[0];

  const lines = [
    `Portfolio briefing for ${snapshot.today}.`,
    `${active.length} active ${active.length === 1 ? "project" : "projects"}; ${snapshot.kpis.activeNeedsAttention} currently ${snapshot.kpis.activeNeedsAttention === 1 ? "has" : "have"} attention reasons.`,
    urgent.length
      ? `${urgent.length} active ${urgent.length === 1 ? "project has" : "projects have"} urgent performance issues: ${urgent.map((project) => project.name).join(", ")}.`
      : "No active project has an urgent performance issue in the populated records.",
    nextDeadline
      ? `Next recorded deadline: ${nextDeadline.projectName} — ${nextDeadline.name} on ${nextDeadline.plannedDate}.`
      : "No upcoming milestones are recorded for active projects.",
    noUpcoming.length
      ? `${noUpcoming.length} active ${noUpcoming.length === 1 ? "project has" : "projects have"} no upcoming milestone: ${noUpcoming.map((project) => project.name).join(", ")}.`
      : "Every active project has an upcoming milestone.",
    unmeasured.length
      ? `Health is unmeasured for ${unmeasured.length} active ${unmeasured.length === 1 ? "project" : "projects"}: ${unmeasured.map((project) => project.name).join(", ")}.`
      : "No active project has completely unmeasured health.",
    trackingGaps.length
      ? `${trackingGaps.length} active ${trackingGaps.length === 1 ? "project has" : "projects have"} partial or unavailable health evidence.`
      : "All active projects meet the documented health-evidence threshold.",
    integrationGaps.length
      ? `${integrationGaps.length} active ${integrationGaps.length === 1 ? "project has" : "projects have"} at least one missing confirmed Notion or Dropbox link.`
      : "All active projects have confirmed Notion and Dropbox links.",
  ];
  return lines.join("\n");
}

export function buildPortfolioSnapshot(
  readers: PortfolioReaders = defaultPortfolioReaders,
  todayValue: Date | string = new Date(),
): PortfolioSnapshot {
  const today = todayToDateOnly(todayValue);
  const sourceProjects = readers
    .getAllProjects()
    .filter((project) => isPortfolioProject({ slug: project.slug, name: project.meta.name }));
  // One read of the Notion snapshot for the whole portfolio, joined on the human-confirmed
  // notion_page_id. A missing snapshot simply leaves every created time null.
  const createdBySlug = new Map<string, string>();
  const notionMap = (readers.getProjectMap ?? getProjectMapSnapshot)();
  if (notionMap) {
    const createdByPageId = new Map(
      notionMap.projects.map((entry) => [entry.notion_page_id, entry.created_time]),
    );
    for (const project of sourceProjects) {
      const pageId = project.meta.notion_page_id;
      const created = pageId ? createdByPageId.get(pageId) : undefined;
      if (created) createdBySlug.set(project.slug, created);
    }
  }
  const projects = sourceProjects
    .map((project) => ({
      ...buildProjectPortfolioSnapshot(readProjectAnalysisRecords(project, readers), today),
      notionCreatedTime: createdBySlug.get(project.slug) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en") || a.slug.localeCompare(b.slug, "en"));
  const activeProjects = projects.filter((project) => project.active);
  const reviewQueue = activeProjects
    .filter((project) => project.attentionReasons.length > 0)
    .sort(compareProjectsByAttention);
  const upcomingMilestones = activeProjects
    .flatMap((project) =>
      project.nextUpcomingMilestone
        ? [{
            ...project.nextUpcomingMilestone,
            projectSlug: project.slug,
            projectName: project.name,
          }]
        : [],
    )
    .sort(
      (a, b) =>
        a.plannedDate.localeCompare(b.plannedDate) ||
        a.projectName.localeCompare(b.projectName, "en") ||
        a.id.localeCompare(b.id),
    );
  const statusDistribution: Record<ProjectStatus, number> = {
    "not-started": 0,
    "in-progress": 0,
    complete: 0,
    abandoned: 0,
  };
  for (const project of projects) statusDistribution[project.status]++;

  const scheduleOutlook: Record<MilestoneHorizon, number> = {
    overdue: 0,
    next7: 0,
    days8to30: 0,
    days31to90: 0,
    later: 0,
  };
  for (const project of activeProjects) {
    for (const horizon of Object.keys(scheduleOutlook) as MilestoneHorizon[]) {
      scheduleOutlook[horizon] += project.milestoneHorizons[horizon];
    }
  }

  const attentionCategoryDistribution: Record<AttentionCategory, number> = {
    performance: 0,
    planning: 0,
    evidence: 0,
    integration: 0,
  };
  const reasonCounts = new Map<
    AttentionReason["code"],
    { label: string; count: number }
  >();
  for (const project of activeProjects) {
    for (const reason of project.attentionReasons) {
      attentionCategoryDistribution[reason.category]++;
      const current = reasonCounts.get(reason.code);
      reasonCounts.set(reason.code, {
        label: reason.label.replace(/^\d+ /, ""),
        count: (current?.count ?? 0) + 1,
      });
    }
  }

  const sourceCoverage = TRACKING_AREAS.map((area) => {
    const populatedProjects = projects.filter((project) =>
      project.populatedTrackingAreas.includes(area),
    ).length;
    return {
      area,
      label: TRACKING_AREA_LABELS[area],
      populatedProjects,
      totalProjects: projects.length,
      percent: projects.length === 0 ? 0 : Math.round((populatedProjects / projects.length) * 100),
    };
  });

  const withoutBriefing: Omit<PortfolioSnapshot, "briefing"> = {
    today,
    generatedFrom: "local-authored-records",
    projects,
    activeProjects,
    reviewQueue,
    kpis: {
      totalProjects: projects.length,
      activeProjects: activeProjects.length,
      activeNeedsAttention: reviewQueue.length,
      overdueMilestones: scheduleOutlook.overdue,
      dueWithin30Days:
        scheduleOutlook.next7 + scheduleOutlook.days8to30,
      activeUnmeasuredHealth: activeProjects.filter(
        (project) => project.healthEvidenceState === "unmeasured",
      ).length,
    },
    statusDistribution,
    activeHealthDistribution: {
      unmeasured: activeProjects.filter(
        (project) => project.healthEvidenceState === "unmeasured",
      ).length,
      partial: activeProjects.filter(
        (project) => project.healthEvidenceState === "partial",
      ).length,
      measuredHealthy: activeProjects.filter(
        (project) => project.healthAssessment === "healthy",
      ).length,
      measuredNeedsAttention: activeProjects.filter(
        (project) => project.healthAssessment === "needs-attention",
      ).length,
    },
    scheduleOutlook,
    attentionCategoryDistribution,
    attentionReasonDistribution: Array.from(reasonCounts, ([code, value]) => ({
      code,
      ...value,
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "en")),
    sourceCoverage,
    upcomingMilestones,
  };
  return { ...withoutBriefing, briefing: generatePortfolioBriefing(withoutBriefing) };
}

export function getProjectPortfolioIntelligence(
  slug: string,
  readers: PortfolioReaders = defaultPortfolioReaders,
  todayValue: Date | string = new Date(),
): { snapshot: ProjectPortfolioSnapshot; records: ProjectAnalysisRecords; today: string } {
  const project = readers.getProject(slug);
  const records = readProjectAnalysisRecords(project, readers);
  const today = todayToDateOnly(todayValue);
  return {
    snapshot: buildProjectPortfolioSnapshot(records, today),
    records,
    today,
  };
}
