import { notionFetch } from "./client";
import { normalizeNotionId } from "./ids";
import type { ProjectStatus } from "@/lib/schema";

const STUDIO_PROJECTS_DB_TITLE = "Studio Projects";

interface NotionRichText {
  plain_text: string;
}

interface NotionSearchResult {
  object: "database" | "page";
  id: string;
  title?: NotionRichText[];
}

interface NotionSearchResponse {
  results: NotionSearchResult[];
}

interface NotionQueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionPageProperty {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  multi_select?: Array<{ name: string }>;
  people?: Array<{ id: string; name?: string | null }>;
  select?: { name: string } | null;
  status?: { name: string } | null;
}

export interface NotionPage {
  id: string;
  url: string;
  properties: Record<string, NotionPageProperty>;
}

export interface StudioProjectPage {
  id: string;
  name: string;
  url: string;
}

let cachedDatabaseId: string | null = null;

/** Finds the "Studio Projects" database id via search, once per process. */
export async function getStudioProjectsDatabaseId(): Promise<string> {
  if (cachedDatabaseId) return cachedDatabaseId;
  // This adapter uses the 2022 database endpoint. A current data-source ID
  // is a different object and must never be sent to /databases/{id}.
  const configured = process.env.NOTION_PROJECTS_DATABASE_ID
    ? normalizeNotionId(process.env.NOTION_PROJECTS_DATABASE_ID, "NOTION_PROJECTS_DATABASE_ID")
    : null;
  if (configured) {
    cachedDatabaseId = configured;
    return configured;
  }

  const { results } = await notionFetch<NotionSearchResponse>("/search", {
    method: "POST",
    body: JSON.stringify({ query: STUDIO_PROJECTS_DB_TITLE, filter: { property: "object", value: "database" } }),
  });

  const match = results.find(
    (r) => r.object === "database" && (r.title ?? []).map((t) => t.plain_text).join("") === STUDIO_PROJECTS_DB_TITLE,
  );
  if (!match) {
    throw new Error(
      `Could not find a "${STUDIO_PROJECTS_DB_TITLE}" database shared with this integration. ` +
        `Run "npm run notion-probe" to check what's currently shared.`,
    );
  }

  cachedDatabaseId = match.id;
  return match.id;
}

function extractTitleProperty(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title") {
      return (prop.title ?? []).map((t) => t.plain_text).join("") || "(untitled)";
    }
  }
  return "(untitled)";
}

/** Lists every page (row) in the Studio Projects database, paginated. */
export async function listStudioProjectPages(): Promise<StudioProjectPage[]> {
  const databaseId = await getStudioProjectsDatabaseId();
  const pages: StudioProjectPage[] = [];
  let cursor: string | undefined;

  do {
    const response = await notionFetch<NotionQueryResponse>(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    for (const page of response.results) {
      pages.push({ id: page.id, name: extractTitleProperty(page), url: page.url });
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return pages;
}

export async function getStudioProjectPage(pageId: string): Promise<NotionPage> {
  return notionFetch<NotionPage>(`/pages/${pageId}`);
}

/**
 * Studio Projects' Status options are confirmed (see CLAUDE.md) to be exactly
 * "Not Started"/"In Progress"/"Complete"/"Abandoned" — this maps those
 * verbatim onto projectStatusSchema's enum values. Returns null if no
 * Status property is found or its value doesn't match a known option
 * (never guess/coerce an unrecognized value).
 */
const STATUS_OPTION_TO_ENUM: Record<string, string> = {
  "Not Started": "not-started",
  "In Progress": "in-progress",
  Complete: "complete",
  Abandoned: "abandoned",
};

const STATUS_ENUM_TO_OPTION: Record<ProjectStatus, string> = {
  "not-started": "Not Started",
  "in-progress": "In Progress",
  complete: "Complete",
  abandoned: "Abandoned",
};

export function extractNotionProjectStatus(page: NotionPage): string | null {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "select" || prop.type === "status") {
      const optionName = prop.select?.name ?? prop.status?.name;
      if (optionName && optionName in STATUS_OPTION_TO_ENUM) {
        return STATUS_OPTION_TO_ENUM[optionName];
      }
    }
  }
  return null;
}

function richTextProperty(page: NotionPage, name: string): string {
  const property = page.properties[name];
  return (property?.rich_text ?? []).map((item) => item.plain_text).join("").trim();
}

export function extractNotionProjectDetails(page: NotionPage) {
  return {
    client: richTextProperty(page, "Client"),
    location: richTextProperty(page, "Location"),
    projectTypes: (page.properties["Project Type"]?.multi_select ?? []).map((item) => item.name),
    scope: (page.properties.Scope?.multi_select ?? []).map((item) => item.name),
    team: (page.properties.Team?.people ?? []).map((person) => person.name?.trim() || `notion-user:${person.id}`),
  };
}

/** Writes the confirmed Studio Projects Status property on an already-linked page. */
export async function updateStudioProjectStatus(
  pageId: string,
  status: ProjectStatus,
): Promise<void> {
  await notionFetch(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        Status: { status: { name: STATUS_ENUM_TO_OPTION[status] } },
      },
    }),
  });
}

export async function createStudioProject(input: {
  name: string;
  status: ProjectStatus;
  client?: string;
  location?: string;
  projectTypes?: string[];
  scopes?: string[];
}): Promise<{ id: string; url: string }> {
  const databaseId = await getStudioProjectsDatabaseId();
  const properties = buildStudioProjectProperties(input);

  return notionFetch<{ id: string; url: string }>("/pages", {
    method: "POST",
    body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
  });
}

export function buildStudioProjectProperties(input: {
  name: string;
  status: ProjectStatus;
  client?: string;
  location?: string;
  projectTypes?: string[];
  scopes?: string[];
}): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: input.name } }] },
    Status: { status: { name: STATUS_ENUM_TO_OPTION[input.status] } },
  };
  if (input.client) properties.Client = { rich_text: [{ text: { content: input.client } }] };
  if (input.location) properties.Location = { rich_text: [{ text: { content: input.location } }] };
  if (input.projectTypes?.length) {
    properties["Project Type"] = {
      multi_select: input.projectTypes.map((name) => ({ name })),
    };
  }
  if (input.scopes?.length) {
    properties.Scope = { multi_select: input.scopes.map((name) => ({ name })) };
  }
  return properties;
}
