import type { ProjectListEvidenceFilter, ProjectListSort, ProjectListStatusFilter } from "./portfolioFilters";

export const PROJECT_LIST_PREFERENCES_KEY = "mi.projects.view.v1";
export interface ProjectListPreferences {
  status: ProjectListStatusFilter;
  evidence: ProjectListEvidenceFilter;
  sort: ProjectListSort;
}
export const DEFAULT_PROJECT_LIST_PREFERENCES: ProjectListPreferences = { status: "active", evidence: "all", sort: "attention" };

export function parseProjectListPreferences(raw: string | null): ProjectListPreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      status: ["active", "all", "not-started", "in-progress", "complete", "abandoned"].includes(value?.status) ? value.status : "active",
      evidence: ["all", "needs-attention", "unmeasured", "partial", "measured"].includes(value?.evidence) ? value.evidence : "all",
      sort: ["manual", "attention", "deadline", "name", "health", "created-desc", "created-asc", "activity-desc"].includes(value?.sort) ? value.sort : "attention",
    };
  } catch { return DEFAULT_PROJECT_LIST_PREFERENCES; }
}
