import type {
  HealthEvidenceState,
  ProjectPortfolioSnapshot,
} from "@/lib/content/portfolioAnalytics";
import type { ProjectStatus } from "@/lib/schema";

export type ProjectListStatusFilter = ProjectStatus | "active" | "all";
export type ProjectListEvidenceFilter =
  | "all"
  | "needs-attention"
  | HealthEvidenceState;
export type ProjectListSort =
  | "manual"
  | "attention"
  | "deadline"
  | "name"
  | "health"
  | "created-desc"
  | "created-asc"
  | "activity-desc";

export interface ProjectListOptions {
  query?: string;
  status?: ProjectListStatusFilter;
  evidence?: ProjectListEvidenceFilter;
  sort?: ProjectListSort;
  /** Personal drag-and-drop order (slugs). Only consulted by the "manual" sort. */
  manualOrder?: string[];
}

/** Sorts that arrange by a date the project actually carries. */
export function isDateSort(sort: ProjectListSort): boolean {
  return sort === "created-desc" || sort === "created-asc" || sort === "activity-desc";
}

function compareAttention(
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

export function filterAndSortPortfolioProjects(
  projects: ProjectPortfolioSnapshot[],
  options: ProjectListOptions = {},
): ProjectPortfolioSnapshot[] {
  const query = options.query?.trim().toLowerCase() ?? "";
  const status = options.status ?? "active";
  const evidence = options.evidence ?? "all";
  const sort = options.sort ?? "attention";
  const filtered = projects.filter((project) => {
    if (status === "active" && !project.active) return false;
    if (status !== "active" && status !== "all" && project.status !== status) return false;
    if (evidence === "needs-attention" && project.attentionReasons.length === 0) return false;
    if (
      evidence !== "all" &&
      evidence !== "needs-attention" &&
      project.healthEvidenceState !== evidence
    ) {
      return false;
    }
    if (!query) return true;
    return [project.name, project.address, project.client, project.buildingType ?? ""].some(
      (value) => value.toLowerCase().includes(query),
    );
  });

  const byName = (a: ProjectPortfolioSnapshot, b: ProjectPortfolioSnapshot) =>
    a.name.localeCompare(b.name, "en") || a.slug.localeCompare(b.slug, "en");

  // Projects with no date sort after those that have one, in both directions -- "unknown" is
  // never treated as very old or very new.
  function compareByDate(
    a: ProjectPortfolioSnapshot,
    b: ProjectPortfolioSnapshot,
    pick: (project: ProjectPortfolioSnapshot) => string | null,
    direction: "asc" | "desc",
  ): number {
    const aDate = pick(a);
    const bDate = pick(b);
    if (!aDate && !bDate) return byName(a, b);
    if (!aDate) return 1;
    if (!bDate) return -1;
    const comparison = aDate.localeCompare(bDate);
    return (direction === "desc" ? -comparison : comparison) || byName(a, b);
  }

  const manualRank = new Map((options.manualOrder ?? []).map((slug, index) => [slug, index]));

  return filtered.sort((a, b) => {
    if (sort === "manual") {
      const aRank = manualRank.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
      const bRank = manualRank.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
      // Anything never dragged keeps a stable, meaningful position at the end.
      return aRank - bRank || compareAttention(a, b);
    }
    if (sort === "created-desc") return compareByDate(a, b, (project) => project.notionCreatedTime, "desc");
    if (sort === "created-asc") return compareByDate(a, b, (project) => project.notionCreatedTime, "asc");
    if (sort === "activity-desc") return compareByDate(a, b, (project) => project.latestRecordedActivity, "desc");
    if (sort === "attention") return compareAttention(a, b);
    if (sort === "deadline") {
      const aDate = a.nextIncompleteMilestone?.plannedDate ?? "9999-12-31";
      const bDate = b.nextIncompleteMilestone?.plannedDate ?? "9999-12-31";
      return aDate.localeCompare(bDate) || a.name.localeCompare(b.name, "en");
    }
    if (sort === "health") {
      const aUnmeasured = a.healthEvidenceState === "unmeasured" ? 1 : 0;
      const bUnmeasured = b.healthEvidenceState === "unmeasured" ? 1 : 0;
      return (
        aUnmeasured - bUnmeasured ||
        a.healthScore - b.healthScore ||
        a.name.localeCompare(b.name, "en")
      );
    }
    return a.name.localeCompare(b.name, "en") || a.slug.localeCompare(b.slug, "en");
  });
}
