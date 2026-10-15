import { notionFetch } from "./client";
import { normalizeNotionId } from "./ids";
import type { ScheduleType } from "@/lib/schema";

const STUDIO_SCHEDULE_DB_TITLE = "STUDIO Schedule";

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

interface NotionDateProp {
  type: "date";
  date: { start: string; end: string | null } | null;
}
interface NotionSelectProp {
  type: "select";
  select: { name: string } | null;
}
interface NotionStatusProp {
  type: "status";
  status: { name: string } | null;
}
interface NotionTitleProp {
  type: "title";
  title: NotionRichText[];
}
interface NotionMultiSelectProp {
  type: "multi_select";
  multi_select: { name: string }[];
}
interface NotionNumberProp {
  type: "number";
  number: number | null;
}
interface NotionRelationProp {
  type: "relation";
  relation: { id: string }[];
}
interface NotionPeopleProp {
  type: "people";
  people: { id: string; name?: string | null }[];
}

type NotionProperty =
  | NotionDateProp
  | NotionSelectProp
  | NotionStatusProp
  | NotionTitleProp
  | NotionMultiSelectProp
  | NotionNumberProp
  | NotionRelationProp
  | NotionPeopleProp
  | { type: string };

interface NotionSchedulePage {
  parent?: { database_id?: string };
  in_trash?: boolean;
  id: string;
  url?: string;
  last_edited_time?: string;
  properties: Record<string, NotionProperty>;
}
interface NotionQueryResponse {
  results: NotionSchedulePage[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface NotionScheduleEntry {
  id: string;
  url: string | null;
  name: string;
  date: string | null;
  /** End of the Notion Date range. Start Time/End Time below are separate work-session fields. */
  dateEnd: string | null;
  startTime: string | null;
  endTime: string | null;
  doDate: string | null;
  completedDate: string | null;
  lastEditedTime: string | null;
  status: string | null;
  /** Whatever the Type multi-select/select holds — e.g. "Milestone", "Meeting". Not constrained to a fixed enum since the full option list isn't confirmed. */
  type: string[];
  hours: number | null;
  /** Notion Attendance people, decoded as-is -- never invent a display name when Notion omits one. */
  attendees: { id: string; name: string | null }[];
  projectPageIds: string[];
}

let cachedDatabaseId: string | null = null;

export async function getStudioScheduleDatabaseId(): Promise<string> {
  if (cachedDatabaseId) return cachedDatabaseId;
  // This adapter uses the 2022 database endpoint. A current data-source ID
  // is a different object and must never be sent to /databases/{id}.
  const configured = process.env.NOTION_SCHEDULE_DATABASE_ID
    ? normalizeNotionId(process.env.NOTION_SCHEDULE_DATABASE_ID, "NOTION_SCHEDULE_DATABASE_ID")
    : null;
  if (configured) {
    cachedDatabaseId = configured;
    return configured;
  }

  const { results } = await notionFetch<NotionSearchResponse>("/search", {
    method: "POST",
    body: JSON.stringify({ query: STUDIO_SCHEDULE_DB_TITLE, filter: { property: "object", value: "database" } }),
  });

  const match = results.find(
    (r) => r.object === "database" && (r.title ?? []).map((t) => t.plain_text).join("") === STUDIO_SCHEDULE_DB_TITLE,
  );
  if (!match) {
    throw new Error(
      `Could not find a "${STUDIO_SCHEDULE_DB_TITLE}" database shared with this integration. ` +
        `Run "npm run notion-probe" to check what's currently shared.`,
    );
  }

  cachedDatabaseId = match.id;
  return match.id;
}

function normalizeEntry(page: NotionSchedulePage): NotionScheduleEntry {
  const title = page.properties.Name as NotionTitleProp | undefined;
  const dateProp = page.properties.Date as NotionDateProp | undefined;
  const startTimeProp = page.properties["Start Time"] as NotionDateProp | undefined;
  const endTimeProp = page.properties["End Time"] as NotionDateProp | undefined;
  const doDateProp = page.properties["Do Date"] as NotionDateProp | undefined;
  const completedDateProp = page.properties["Completed Date"] as NotionDateProp | undefined;
  const statusProp = page.properties.Status as NotionStatusProp | undefined;
  const typeProp = page.properties.Type as NotionMultiSelectProp | undefined;
  const hoursProp = page.properties["Hours Manual"] as NotionNumberProp | undefined;
  const attendanceProp = page.properties.Attendance as NotionPeopleProp | undefined;
  const projectsProp = page.properties.Projects as NotionRelationProp | undefined;

  return {
    id: page.id,
    url: page.url ?? null,
    name: (title?.title ?? []).map((t) => t.plain_text).join("") || "(untitled)",
    date: dateProp?.date?.start ?? null,
    dateEnd: dateProp?.date?.end ?? null,
    startTime: startTimeProp?.date?.start ?? null,
    endTime: endTimeProp?.date?.start ?? null,
    doDate: doDateProp?.date?.start ?? null,
    completedDate: completedDateProp?.date?.start ?? null,
    lastEditedTime: page.last_edited_time ?? null,
    status: statusProp?.status?.name ?? null,
    type: (typeProp?.multi_select ?? []).map((t) => t.name),
    hours: hoursProp?.number ?? null,
    attendees: (attendanceProp?.people ?? []).map((p) => ({ id: p.id, name: p.name?.trim() || null })),
    projectPageIds: (projectsProp?.relation ?? []).map((project) => project.id),
  };
}

/** Reads one exact STUDIO Schedule page immediately before a confirmed update. */
export async function getScheduleEntry(eventPageId: string): Promise<NotionScheduleEntry> {
  const page = await notionFetch<NotionSchedulePage>(`/pages/${normalizeNotionId(eventPageId, "eventPageId")}`);
  return normalizeEntry(page);
}

/** Recoverable removal of one reviewed schedule entry, never a general page delete. */
export async function getRemovableScheduleEntry(eventPageId: string): Promise<NotionScheduleEntry> {
  const id = normalizeNotionId(eventPageId, "eventPageId");
  const databaseId = await getStudioScheduleDatabaseId();
  const page = await notionFetch<NotionSchedulePage>(`/pages/${id}`);
  if (!page.parent?.database_id || normalizeNotionId(page.parent.database_id, "parent") !== normalizeNotionId(databaseId, "schedule")) {
    throw new Error("This page is not an entry in the configured STUDIO Schedule.");
  }
  if (page.in_trash) throw new Error("This event is already in Notion Trash. Sync the calendar.");
  return normalizeEntry(page);
}

export async function trashScheduleEntry(input: {
  eventPageId: string;
  name: string;
  expectedLastEditedTime: string;
}): Promise<void> {
  const id = normalizeNotionId(input.eventPageId, "eventPageId");
  const databaseId = await getStudioScheduleDatabaseId();
  const page = await notionFetch<NotionSchedulePage>(`/pages/${id}`);
  if (!page.parent?.database_id || normalizeNotionId(page.parent.database_id, "parent") !== normalizeNotionId(databaseId, "schedule")) {
    throw new Error("This page is not an entry in the configured STUDIO Schedule.");
  }
  if (page.in_trash) throw new Error("This event is already in Notion Trash. Sync the calendar.");
  if (page.last_edited_time !== input.expectedLastEditedTime || normalizeEntry(page).name !== input.name) {
    throw new Error("This event changed in Notion. Sync and review its removal again.");
  }
  const updated = await notionFetch<NotionSchedulePage>(`/pages/${id}`, {
    method: "PATCH", body: JSON.stringify({ in_trash: true }),
  });
  if (updated.in_trash !== true) throw new Error("Notion did not verify removal. Sync before trying again.");
}

/** Queries STUDIO Schedule entries related to a given Studio Projects page id. */
export async function queryScheduleEntriesForProject(projectPageId: string): Promise<NotionScheduleEntry[]> {
  const databaseId = await getStudioScheduleDatabaseId();
  const entries: NotionScheduleEntry[] = [];
  let cursor: string | undefined;

  do {
    const response = await notionFetch<NotionQueryResponse>(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        start_cursor: cursor,
        filter: {
          property: "Projects",
          relation: { contains: projectPageId },
        },
        // `Projects` was confirmed against the live STUDIO Schedule schema.
        // Server-side filtering avoids downloading all firm rows per project.
      }),
    });
    entries.push(...response.results.map(normalizeEntry));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return entries;
}

export interface FirmScheduleWindow {
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  /** Inclusive, YYYY-MM-DD. */
  to: string;
}

/**
 * Queries every STUDIO Schedule entry in a bounded date window, regardless of any
 * Projects relation -- unlike queryScheduleEntriesForProject, this deliberately
 * includes entries with no project relation at all (e.g. PTO, internal-only
 * blocks), which is exactly what firm-wide workload/availability context needs.
 * Uses a real Notion API date filter (confirmed against the live database via
 * npm run notion-probe) rather than a client-side filter, so it stays bounded.
 *
 * The two bounds MUST be sent as a compound `and` of two single-condition date
 * filters, not as two keys on one `date: {...}` object -- confirmed live against
 * the real database 2026-07-27: Notion silently drops `on_or_after` when it's
 * combined with `on_or_before` under a single date filter object, returning
 * hundreds of entries stretching back years instead of the bounded window.
 */
export async function queryFirmScheduleWindow(window: FirmScheduleWindow): Promise<NotionScheduleEntry[]> {
  const databaseId = await getStudioScheduleDatabaseId();
  const entries: NotionScheduleEntry[] = [];
  let cursor: string | undefined;

  do {
    const response = await notionFetch<NotionQueryResponse>(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        start_cursor: cursor,
        filter: {
          and: [
            { property: "Date", date: { on_or_after: window.from } },
            { property: "Date", date: { on_or_before: window.to } },
          ],
        },
      }),
    });
    for (const page of response.results) entries.push(normalizeEntry(page));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return entries;
}

export type StudioScheduleType = ScheduleType;
export type StudioScheduleStatus = "Not started" | "In progress" | "Done";

interface NotionCreatedPage {
  id: string;
  url: string;
}

/**
 * A personal plan is intentionally a firm-wide STUDIO Schedule entry rather than
 * a project entry. Only the reviewed public scheduling fields cross the local
 * privacy boundary; no journal body, mood, tags, or Projects relation is sent.
 */
export function buildPersonalScheduleProperties(input: {
  name: string;
  date: string;
  type: StudioScheduleType;
  startTime?: string | null;
  endTime?: string | null;
  attendeeIds?: string[];
}) {
  return {
    Name: { title: [{ text: { content: input.name } }] },
    Date: { date: { start: input.startTime ?? input.date, end: input.endTime ?? null } },
    Type: { multi_select: [{ name: input.type }] },
    ...(input.attendeeIds?.length ? { Attendance: { people: input.attendeeIds.map((id) => ({ id })) } } : {}),
  };
}

export async function createPersonalScheduleEntry(input: {
  name: string;
  date: string;
  type: StudioScheduleType;
  startTime?: string | null;
  endTime?: string | null;
  attendeeIds?: string[];
}): Promise<NotionCreatedPage> {
  const databaseId = await getStudioScheduleDatabaseId();
  return notionFetch<NotionCreatedPage>("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: buildPersonalScheduleProperties(input),
    }),
  });
}

export function buildScheduleProperties(input: {
  projectPageId: string;
  name: string;
  date: string;
  type: StudioScheduleType;
  startTime?: string | null;
  endTime?: string | null;
  hours?: number | null;
  attendeeIds?: string[];
  status?: StudioScheduleStatus;
  completedDate?: string | null;
}) {
  return {
    Name: { title: [{ text: { content: input.name } }] },
    Date: { date: { start: input.startTime ?? input.date, end: input.endTime ?? null } },
    Type: { multi_select: [{ name: input.type }] },
    Projects: { relation: [{ id: input.projectPageId }] },
    ...(input.hours !== undefined && input.hours !== null ? { "Hours Manual": { number: input.hours } } : {}),
    ...(input.attendeeIds?.length ? { Attendance: { people: input.attendeeIds.map((id) => ({ id })) } } : {}),
    ...(input.status ? { Status: { status: { name: input.status } } } : {}),
    ...(input.completedDate !== undefined
      ? { "Completed Date": { date: input.completedDate ? { start: input.completedDate } : null } }
      : {}),
  };
}

export async function createProjectScheduleEntry(input: {
  projectPageId: string;
  name: string;
  date: string;
  type: StudioScheduleType;
  startTime?: string | null;
  endTime?: string | null;
  hours?: number | null;
  attendeeIds?: string[];
  status?: StudioScheduleStatus;
  completedDate?: string | null;
}): Promise<NotionCreatedPage> {
  const databaseId = await getStudioScheduleDatabaseId();
  return notionFetch<NotionCreatedPage>("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: buildScheduleProperties(input),
    }),
  });
}

export async function updateProjectScheduleEntry(input: {
  eventPageId: string;
  projectPageId?: string;
  date?: string;
  status?: StudioScheduleStatus;
  completedDate?: string | null;
}): Promise<void> {
  const properties = buildScheduleUpdateProperties(input);
  if (Object.keys(properties).length === 0) return;
  await notionFetch(`/pages/${input.eventPageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
}

export async function duplicateScheduleEntry(input: {
  name: string;
  date: string;
  type: StudioScheduleType;
  startTime?: string | null;
  endTime?: string | null;
  projectPageIds: string[];
  attendeeIds: string[];
}): Promise<NotionCreatedPage> {
  const databaseId = await getStudioScheduleDatabaseId();
  return notionFetch<NotionCreatedPage>("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        Name: { title: [{ text: { content: input.name } }] },
        Date: { date: { start: input.startTime ?? input.date, end: input.endTime ?? null } },
        Type: { multi_select: [{ name: input.type }] },
        ...(input.projectPageIds.length ? { Projects: { relation: input.projectPageIds.map((id) => ({ id })) } } : {}),
        ...(input.attendeeIds.length ? { Attendance: { people: input.attendeeIds.map((id) => ({ id })) } } : {}),
      },
    }),
  });
}

export function buildScheduleUpdateProperties(input: {
  projectPageId?: string;
  date?: string;
  status?: StudioScheduleStatus;
  completedDate?: string | null;
}) {
  const properties: Record<string, unknown> = {};
  if (input.date !== undefined) properties.Date = { date: { start: input.date } };
  if (input.projectPageId !== undefined) properties.Projects = { relation: [{ id: input.projectPageId }] };
  if (input.status !== undefined) properties.Status = { status: { name: input.status } };
  if (input.completedDate !== undefined) {
    properties["Completed Date"] = { date: input.completedDate ? { start: input.completedDate } : null };
  }
  return properties;
}

/**
 * Generic date/status PATCH for any STUDIO Schedule entry, firm-wide or project-scoped --
 * unlike updateProjectScheduleEntry, this never touches Projects, which would be wrong for
 * entries with no project relation at all (PTO, internal-only blocks, personal plans).
 * Used by the schedule-adjust chat agent, which only ever proposes date/status changes.
 */
export async function updateScheduleEntryDate(input: {
  eventPageId: string;
  date?: string;
  dateEnd?: string | null;
  status?: StudioScheduleStatus;
}): Promise<void> {
  const properties: Record<string, unknown> = {};
  if (input.date !== undefined) {
    properties.Date = {
      date: {
        start: input.date,
        ...(input.dateEnd !== undefined ? { end: input.dateEnd } : {}),
      },
    };
  }
  if (input.status !== undefined) properties.Status = { status: { name: input.status } };
  if (Object.keys(properties).length === 0) return;
  await notionFetch(`/pages/${input.eventPageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
}
