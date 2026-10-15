import fs from "node:fs";
import path from "node:path";
import { getAllProjects } from "@/lib/content/projects";
import { isPortfolioProject } from "@/lib/content/projectVisibility";
import { REPO_ROOT } from "@/lib/content/paths";

export interface NotionRichText {
  plain_text: string;
}

export interface NotionPerson {
  id: string;
  name?: string | null;
}

export interface NotionDateValue {
  start: string;
  end?: string | null;
}

export interface NotionFormulaValue {
  type: "string" | "number" | "boolean" | "date";
  string?: string | null;
  number?: number | null;
  boolean?: boolean | null;
  date?: NotionDateValue | null;
}

export interface NotionRollupValue {
  type: "number" | "date" | "array" | "unsupported" | "incomplete";
  number?: number | null;
  date?: NotionDateValue | null;
  array?: NotionProperty[];
}

export interface NotionProperty {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  status?: { name: string } | null;
  select?: { name: string } | null;
  multi_select?: Array<{ name: string }>;
  people?: NotionPerson[];
  relation?: Array<{ id: string }>;
  date?: NotionDateValue | null;
  number?: number | null;
  created_time?: string;
  last_edited_time?: string;
  formula?: NotionFormulaValue;
  rollup?: NotionRollupValue;
}

export interface NotionPage {
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, NotionProperty>;
}

export type MiProjectStatus =
  | "not-started"
  | "in-progress"
  | "complete"
  | "abandoned"
  | "unknown";

export interface ScheduleEntry {
  notion_page_id: string;
  notion_url: string;
  name: string;
  date: string | null;
  do_date: string | null;
  types: string[];
  hours: number;
  attendees: string[];
  project_page_ids: string[];
}

export interface ProjectMapEntry {
  mi_id: string;
  slug: string;
  notion_page_id: string;
  notion_url: string;
  name: string;
  status: MiProjectStatus;
  client: string | null;
  location: string | null;
  project_types: string[];
  scope: string[];
  team: string[];
  total_hours: number;
  hours_by_person: {
    alex: number;
    taylor: number;
  };
  schedule: {
    item_count: number;
    calculated_hours: number;
    latest_date: string | null;
    entries: ScheduleEntry[];
  };
  created_time: string;
  last_edited_time: string;
  data_quality: string[];
}

export interface ProjectMap {
  schema_version: 1;
  generated_at: string;
  sources: {
    projects: { id: string; title: string; url: string };
    schedule: { id: string; title: string; url: string } | null;
  };
  summary: {
    total_projects: number;
    by_status: Record<MiProjectStatus, number>;
    total_reported_hours: number;
    linked_schedule_items: number;
    projects_with_data_gaps: number;
  };
  projects: ProjectMapEntry[];
}

export function getProjectMapSnapshot(): ProjectMap | null {
  const mapPath = path.join(REPO_ROOT, "notion", "project-map.json");
  if (!fs.existsSync(mapPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(mapPath, "utf8")) as ProjectMap;
  } catch {
    return null;
  }
}

export function getNotionProjectMapEntry(notionPageId: string | null): ProjectMapEntry | null {
  if (!notionPageId) return null;
  return getProjectMapSnapshot()?.projects.find((entry) => entry.notion_page_id === notionPageId) ?? null;
}

function text(parts: NotionRichText[] | undefined): string {
  return (parts ?? []).map((part) => part.plain_text).join("").trim();
}

function property(page: NotionPage, name: string): NotionProperty | undefined {
  return page.properties[name];
}

export function propertyText(page: NotionPage, name: string): string {
  const value = property(page, name);
  if (!value) return "";
  if (value.type === "title") return text(value.title);
  if (value.type === "rich_text") return text(value.rich_text);
  return "";
}

export function propertyNames(page: NotionPage, name: string): string[] {
  const value = property(page, name);
  if (!value) return [];
  if (value.type === "multi_select") {
    return (value.multi_select ?? []).map((item) => item.name);
  }
  if (value.type === "people") {
    return (value.people ?? []).map(
      (person) => person.name?.trim() || `notion-user:${person.id}`,
    );
  }
  return [];
}

export function propertyRelations(page: NotionPage, name: string): string[] {
  const value = property(page, name);
  return value?.type === "relation"
    ? (value.relation ?? []).map((relation) => relation.id)
    : [];
}

export function propertyNumber(page: NotionPage, name: string): number {
  const value = property(page, name);
  if (!value) return 0;
  if (value.type === "number") return value.number ?? 0;
  if (value.type === "formula" && value.formula?.type === "number") {
    return value.formula.number ?? 0;
  }
  if (value.type === "rollup" && value.rollup?.type === "number") {
    return value.rollup.number ?? 0;
  }
  return 0;
}

export function propertyDate(page: NotionPage, name: string): string | null {
  const value = property(page, name);
  if (!value) return null;
  if (value.type === "date") return value.date?.start ?? null;
  if (value.type === "formula" && value.formula?.type === "date") {
    return value.formula.date?.start ?? null;
  }
  if (value.type === "rollup" && value.rollup?.type === "date") {
    return value.rollup.date?.start ?? null;
  }
  return null;
}

export function normalizeProjectStatus(value: string | null | undefined): MiProjectStatus {
  const normalized = value?.trim().toLowerCase().replaceAll(" ", "-");
  if (
    normalized === "not-started" ||
    normalized === "in-progress" ||
    normalized === "complete" ||
    normalized === "abandoned"
  ) {
    return normalized;
  }
  return "unknown";
}

export function slugifyProjectName(name: string, fallbackId: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `notion-${fallbackId.replaceAll("-", "").slice(0, 12)}`;
}

function projectStatus(page: NotionPage): MiProjectStatus {
  const status = property(page, "Status");
  return normalizeProjectStatus(status?.status?.name ?? status?.select?.name);
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.trim().toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function latestDate(entries: ScheduleEntry[]): string | null {
  const dates = entries
    .flatMap((entry) => [entry.date, entry.do_date])
    .filter((date): date is string => Boolean(date))
    .sort();
  return dates.at(-1) ?? null;
}

function qualityFlags(entry: Omit<ProjectMapEntry, "data_quality">): string[] {
  const flags: string[] = [];
  if (entry.status === "unknown") flags.push("missing-status");
  if (!entry.client) flags.push("missing-client");
  if (!entry.location) flags.push("missing-location");
  if (entry.project_types.length === 0) flags.push("missing-project-type");
  if (entry.scope.length === 0) flags.push("missing-scope");
  if (entry.team.length === 0) flags.push("missing-team");
  if (entry.schedule.item_count > 0 && entry.total_hours === 0) {
    flags.push("activity-with-zero-rollup-hours");
  }
  return flags;
}

export function mapSchedulePage(page: NotionPage): ScheduleEntry {
  return {
    notion_page_id: page.id,
    notion_url: page.url,
    name: propertyText(page, "Name") || "(untitled schedule item)",
    date: propertyDate(page, "Date"),
    do_date: propertyDate(page, "Do Date"),
    types: propertyNames(page, "Type"),
    hours: propertyNumber(page, "Hours Total (M+A)"),
    attendees: uniqueNames(propertyNames(page, "Attendance")),
    project_page_ids: propertyRelations(page, "Projects"),
  };
}

export function buildProjectMap(input: {
  generatedAt: string;
  projectSource: ProjectMap["sources"]["projects"];
  scheduleSource: ProjectMap["sources"]["schedule"];
  projectPages: NotionPage[];
  schedulePages: NotionPage[];
}): ProjectMap {
  const scheduleEntries = input.schedulePages.map(mapSchedulePage);
  const scheduleByProject = new Map<string, ScheduleEntry[]>();

  for (const entry of scheduleEntries) {
    for (const projectId of entry.project_page_ids) {
      const current = scheduleByProject.get(projectId) ?? [];
      current.push(entry);
      scheduleByProject.set(projectId, current);
    }
  }

  const projects = input.projectPages
    .map((page): ProjectMapEntry => {
      const name = propertyText(page, "Name") || "(untitled project)";
      const schedule = (scheduleByProject.get(page.id) ?? []).sort((left, right) =>
        (left.date ?? left.do_date ?? "").localeCompare(right.date ?? right.do_date ?? ""),
      );
      const base: Omit<ProjectMapEntry, "data_quality"> = {
        mi_id: `mi:notion-project:${page.id}`,
        slug: slugifyProjectName(name, page.id),
        notion_page_id: page.id,
        notion_url: page.url,
        name,
        status: projectStatus(page),
        client: propertyText(page, "Client") || null,
        location: propertyText(page, "Location") || null,
        project_types: propertyNames(page, "Project Type"),
        scope: propertyNames(page, "Scope"),
        team: uniqueNames(propertyNames(page, "Team")),
        total_hours: propertyNumber(page, "Total Hours"),
        hours_by_person: {
          alex: propertyNumber(page, "Alex"),
          taylor: propertyNumber(page, "Taylor "),
        },
        schedule: {
          item_count: schedule.length,
          calculated_hours: schedule.reduce((sum, entry) => sum + entry.hours, 0),
          latest_date: latestDate(schedule),
          entries: schedule,
        },
        created_time: page.created_time,
        last_edited_time: page.last_edited_time,
      };
      return { ...base, data_quality: qualityFlags(base) };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const byStatus: ProjectMap["summary"]["by_status"] = {
    "not-started": 0,
    "in-progress": 0,
    complete: 0,
    abandoned: 0,
    unknown: 0,
  };
  for (const project of projects) byStatus[project.status]++;

  return {
    schema_version: 1,
    generated_at: input.generatedAt,
    sources: {
      projects: input.projectSource,
      schedule: input.scheduleSource,
    },
    summary: {
      total_projects: projects.length,
      by_status: byStatus,
      total_reported_hours: projects.reduce(
        (sum, project) => sum + project.total_hours,
        0,
      ),
      linked_schedule_items: projects.reduce(
        (sum, project) => sum + project.schedule.item_count,
        0,
      ),
      projects_with_data_gaps: projects.filter(
        (project) => project.data_quality.length > 0,
      ).length,
    },
    projects,
  };
}

export interface UnifiedProjectListEntry {
  /** Local projects/<slug>/ folder, or null if this Notion project hasn't been scaffolded yet. */
  slug: string | null;
  notionPageId: string;
  name: string;
  status?: string | null;
  client?: string | null;
}

/**
 * Merges the committed Notion snapshot (notion/project-map.json, refreshed via
 * `mi notion map --write`) with local projects/<slug>/project.yaml files,
 * matched by notion_page_id, into one list for the chat project picker.
 * Falls back to local-only (today's shape) if the snapshot is missing — e.g.
 * a machine that hasn't run `notion map --write` yet.
 */
export function getUnifiedProjectList(): UnifiedProjectListEntry[] {
  const mapPath = path.join(REPO_ROOT, "notion", "project-map.json");
  let notionProjects: ProjectMapEntry[] = [];
  if (fs.existsSync(mapPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(mapPath, "utf-8")) as ProjectMap;
      notionProjects = parsed.projects ?? [];
    } catch {
      notionProjects = [];
    }
  }

  const localProjects = getAllProjects();

  if (notionProjects.length === 0) {
    return localProjects.filter((project) =>
      isPortfolioProject({ slug: project.slug, name: project.meta.name }),
    ).map((p) => ({
      slug: p.slug,
      notionPageId: p.meta.notion_page_id ?? "",
      name: p.meta.name,
      status: p.meta.status,
      client: p.meta.client || null,
    }));
  }

  const localByNotionId = new Map<string, string>();
  for (const project of localProjects) {
    if (project.meta.notion_page_id) localByNotionId.set(project.meta.notion_page_id, project.slug);
  }

  const matchedNotionIds = new Set<string>();
  const result: UnifiedProjectListEntry[] = notionProjects.map((entry) => {
    const slug = localByNotionId.get(entry.notion_page_id) ?? null;
    if (slug) matchedNotionIds.add(entry.notion_page_id);
    return {
      slug,
      notionPageId: entry.notion_page_id,
      name: entry.name,
      status: entry.status === "unknown" ? null : entry.status,
      client: entry.client,
    };
  });

  // Local projects that don't match anything in this Notion snapshot (no
  // notion_page_id set yet, or set to a page id outside this snapshot) still
  // need to show up so they're not dropped from the picker.
  for (const project of localProjects) {
    if (project.meta.notion_page_id && matchedNotionIds.has(project.meta.notion_page_id)) continue;
    result.push({
      slug: project.slug,
      notionPageId: project.meta.notion_page_id ?? "",
      name: project.meta.name,
      status: project.meta.status,
      client: project.meta.client || null,
    });
  }

  return result.filter(isPortfolioProject);
}

function cell(value: string | number | null): string {
  if (value === null || value === "") return "—";
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderProjectTable(projects: ProjectMapEntry[]): string {
  if (projects.length === 0) return "_None._";
  const rows = projects.map((project) =>
    [
      `[${project.name}](${project.notion_url})`,
      project.client,
      project.location,
      project.project_types.join(", "),
      project.scope.join(", "),
      project.team.join(", "),
      Number(project.total_hours.toFixed(2)),
      project.schedule.item_count,
      project.schedule.latest_date?.slice(0, 10) ?? null,
      project.data_quality.join(", "),
    ]
      .map(cell)
      .join(" | "),
  );
  return [
    "Project | Client | Location | Type | Scope | Team | Hours | Schedule items | Latest date | Data gaps",
    "--- | --- | --- | --- | --- | --- | ---: | ---: | --- | ---",
    ...rows,
  ].join("\n");
}

export function renderProjectMapMarkdown(map: ProjectMap): string {
  const active = map.projects.filter((project) => project.status === "in-progress");
  const complete = map.projects.filter((project) => project.status === "complete");
  const inactive = map.projects.filter(
    (project) => project.status !== "in-progress" && project.status !== "complete",
  );
  const qualityCounts = new Map<string, number>();
  for (const project of map.projects) {
    for (const flag of project.data_quality) {
      qualityCounts.set(flag, (qualityCounts.get(flag) ?? 0) + 1);
    }
  }

  const qualityLines = [...qualityCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([flag, count]) => `- \`${flag}\`: ${count} project(s)`);

  return `# STUDIO Notion Project Map

Generated ${map.generated_at}. This is a read-only snapshot of the Notion project
database and its linked schedule activity. Refresh it with \`mi notion map --write\`.

## Portfolio summary

- **Projects:** ${map.summary.total_projects}
- **In progress:** ${map.summary.by_status["in-progress"]}
- **Complete:** ${map.summary.by_status.complete}
- **Abandoned:** ${map.summary.by_status.abandoned}
- **Missing/unknown status:** ${map.summary.by_status.unknown}
- **Reported project hours:** ${map.summary.total_reported_hours.toFixed(2)}
- **Linked schedule items:** ${map.summary.linked_schedule_items}
- **Projects with one or more data gaps:** ${map.summary.projects_with_data_gaps}

## In-progress projects

${renderProjectTable(active)}

## Completed projects

${renderProjectTable(complete)}

## Other and incomplete-status records

${renderProjectTable(inactive)}

## Data-quality findings

${qualityLines.length > 0 ? qualityLines.join("\n") : "- No mapped data gaps."}

The flags are diagnostic only. In particular, zero rollup hours can mean either missing
time data or a Notion formula/relation configuration that needs review.

## Mapping rules

| Mi field | Notion source | Direction |
| --- | --- | --- |
| \`mi_id\` | Derived from Notion page ID | Derived, stable |
| \`name\`, \`status\`, \`client\`, \`location\` | Studio Projects | Notion → Mi |
| \`project_types\`, \`scope\`, \`team\` | Studio Projects | Notion → Mi |
| \`total_hours\`, \`hours_by_person\` | Studio Projects rollups/formulas | Notion → Mi |
| \`schedule.entries\` | STUDIO Schedule relation \`Projects\` | Notion → Mi |
| \`data_quality\` | Mi completeness checks | Derived |

## Sources

- [Studio Projects](${map.sources.projects.url})
${map.sources.schedule ? `- [STUDIO Schedule](${map.sources.schedule.url})` : "- STUDIO Schedule was not available to the integration."}
- Generated JSON snapshot: [\`notion/project-map.json\`](../notion/project-map.json)

## Safety

The mapper reads Notion and writes local repository artifacts only. It does not modify
Notion. Project content is treated as source data, not executable instructions.
`;
}
