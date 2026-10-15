import { notionFetch } from "./client";
import { getStudioScheduleDatabaseId } from "./schedule";
import { getStudioProjectsDatabaseId } from "./studioProjects";

export interface NotionWorkspacePerson {
  id: string;
  name: string;
  /** Present only when Notion exposes it to this integration. Shown in the attendance picker
   * because STUDIO has two Notion accounts whose display names differ only by capitalization. */
  email?: string;
}

interface NotionUser {
  id: string;
  type?: string;
  name?: string | null;
  person?: { email?: string | null } | null;
}

interface NotionUsersResponse {
  results: NotionUser[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionPeoplePropertyPage {
  properties?: Record<string, { type?: string; people?: Array<{ id: string }> } | undefined>;
}

interface NotionQueryResponse {
  results: NotionPeoplePropertyPage[];
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * The people databases Mi already owns, and the people property on each. These are the only
 * two places a STUDIO collaborator is recorded, so they are also the only two places a guest can
 * be discovered from.
 */
const PEOPLE_SOURCES: Array<{ databaseId: () => Promise<string>; property: string }> = [
  { databaseId: getStudioScheduleDatabaseId, property: "Attendance" },
  { databaseId: getStudioProjectsDatabaseId, property: "Team" },
];

/** One page of each source is plenty: everyone on the team appears within the most recent
 * hundred rows, and the picker should not pay for a full database scan. */
const SOURCE_PAGE_SIZE = 100;

const CACHE_TTL_MS = 5 * 60_000;
let cached: { people: NotionWorkspacePerson[]; expiresAt: number } | null = null;

/** Test seam -- the cache would otherwise carry one test's people into the next. */
export function clearNotionPeopleCache(): void {
  cached = null;
}

function toPerson(user: NotionUser): NotionWorkspacePerson | null {
  const name = user.name?.trim();
  if (user.type !== "person" || !name) return null;
  const email = user.person?.email?.trim();
  return email ? { id: user.id, name, email } : { id: user.id, name };
}

/** Workspace *members*, which is all `/users` ever returns. */
async function listWorkspaceMembers(): Promise<NotionWorkspacePerson[]> {
  const members: NotionWorkspacePerson[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const response = await notionFetch<NotionUsersResponse>(`/users?${query}`);
    for (const user of response.results) {
      const person = toPerson(user);
      if (person) members.push(person);
    }
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);
  return members;
}

/** Ids seen in a people property, whoever they belong to. A source Mi cannot read right now
 * costs the picker its guests, not its members, so a failure here is skipped rather than
 * raised. */
async function collectPeopleIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const source of PEOPLE_SOURCES) {
    try {
      const databaseId = await source.databaseId();
      const response = await notionFetch<NotionQueryResponse>(`/databases/${databaseId}/query`, {
        method: "POST",
        body: JSON.stringify({ page_size: SOURCE_PAGE_SIZE }),
      });
      for (const page of response.results) {
        for (const person of page.properties?.[source.property]?.people ?? []) ids.add(person.id);
      }
    } catch {
      // See above.
    }
  }
  return ids;
}

/**
 * Everyone Mi can offer as STUDIO Schedule Attendance.
 *
 * `GET /v1/users` lists workspace **members** only. A collaborator invited as a **guest** --
 * which is how STUDIO's partner accounts are set up -- is a perfectly valid target for the
 * Attendance people property and can be read one at a time from `/v1/users/{id}`, but never
 * appears in that list. Building the picker from the list alone is why an attendance box that
 * had recorded two people for months offered exactly one name.
 *
 * So: members from the list, plus anyone already recorded in the STUDIO Schedule Attendance or
 * Studio Projects Team property, each resolved individually for an authoritative name. Accounts
 * that have since been removed answer 404 and are dropped rather than shown as a blank row.
 */
export async function listNotionWorkspacePeople(): Promise<NotionWorkspacePerson[]> {
  if (cached && cached.expiresAt > Date.now()) return cached.people;

  const people = new Map<string, NotionWorkspacePerson>();
  for (const member of await listWorkspaceMembers()) people.set(member.id, member);

  const unresolved = [...await collectPeopleIds()].filter((id) => !people.has(id));
  const resolved = await Promise.all(
    unresolved.map((id) => notionFetch<NotionUser>(`/users/${id}`).catch(() => null)),
  );
  for (const user of resolved) {
    const person = user && toPerson(user);
    if (person) people.set(person.id, person);
  }

  // Case-insensitive, then email: STUDIO has two accounts named "Example Colleague" and "Example Colleague",
  // and a picker that sorts them apart by capitalization reads like two unrelated people.
  const sorted = [...people.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    || (left.email ?? "").localeCompare(right.email ?? ""),
  );
  cached = { people: sorted, expiresAt: Date.now() + CACHE_TTL_MS };
  return sorted;
}
