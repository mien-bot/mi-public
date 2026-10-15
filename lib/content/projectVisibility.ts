import type { ProjectStatus } from "@/lib/schema";

interface ProjectIdentity {
  slug: string | null;
  name: string;
}

// example-project-68: a photoshoot/marketing record, not an
// architectural project -- has no project data (address, client, drawings,
// etc.) and shouldn't appear in project-facing lists.
const NON_PROJECT_SLUGS = new Set(["example-project-18", "example-project-68"]);
const NON_PROJECT_NAMES = new Set(["admin", "00 admin"]);

function normalizeProjectName(name: string): string {
  return name.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/**
 * Administrative tracking records can remain in the local/Notion source data
 * without appearing in Mi's project-facing lists and selectors.
 */
export function isPortfolioProject(project: ProjectIdentity): boolean {
  if (project.slug && NON_PROJECT_SLUGS.has(project.slug.toLowerCase())) return false;
  return !NON_PROJECT_NAMES.has(normalizeProjectName(project.name));
}

/** Mi defines "active" as work that is currently in progress. */
export function isActiveProjectStatus(status: ProjectStatus): boolean {
  return status === "in-progress";
}
