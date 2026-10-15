import { beforeEach, describe, expect, it, vi } from "vitest";
import { notionFetch } from "./client";
import { clearNotionPeopleCache, listNotionWorkspacePeople } from "./people";

vi.mock("./client", () => ({ notionFetch: vi.fn() }));
vi.mock("./schedule", () => ({ getStudioScheduleDatabaseId: vi.fn(async () => "schedule-db") }));
vi.mock("./studioProjects", () => ({ getStudioProjectsDatabaseId: vi.fn(async () => "projects-db") }));

const NO_PEOPLE = { results: [], has_more: false, next_cursor: null };

function route(handlers: Record<string, unknown>) {
  vi.mocked(notionFetch).mockImplementation(async (path: string) => {
    for (const [prefix, value] of Object.entries(handlers)) {
      if (path.startsWith(prefix)) {
        if (value instanceof Error) throw value;
        return value as never;
      }
    }
    return NO_PEOPLE as never;
  });
}

beforeEach(() => {
  clearNotionPeopleCache();
  vi.mocked(notionFetch).mockReset();
});

describe("Notion workspace people", () => {
  it("paginates members, excludes bots and unnamed users, and sorts named people", async () => {
    let usersCall = 0;
    vi.mocked(notionFetch).mockImplementation(async (path: string) => {
      if (path.startsWith("/users?")) {
        usersCall += 1;
        return (usersCall === 1
          ? { results: [{ id: "b", type: "person", name: "Zoe" }, { id: "bot", type: "bot", name: "Mi" }], has_more: true, next_cursor: "next" }
          : { results: [{ id: "a", type: "person", name: "Alex" }, { id: "x", type: "person", name: null }], has_more: false, next_cursor: null }) as never;
      }
      return NO_PEOPLE as never;
    });

    await expect(listNotionWorkspacePeople()).resolves.toEqual([
      { id: "a", name: "Alex" },
      { id: "b", name: "Zoe" },
    ]);
    expect(notionFetch).toHaveBeenCalledWith("/users?page_size=100&start_cursor=next");
  });

  it("includes a guest that /users never lists but Attendance already records", async () => {
    // The shipped bug: STUDIO's partner is a workspace *guest*, so the attendance picker built
    // from /users alone offered one name for a two-person firm.
    route({
      "/users?": { results: [{ id: "alex", type: "person", name: "Example User", person: { email: "alex@example.com" } }], has_more: false, next_cursor: null },
      "/databases/schedule-db/query": { results: [{ properties: { Attendance: { type: "people", people: [{ id: "alex" }, { id: "taylor" }] } } }], has_more: false, next_cursor: null },
      "/users/taylor": { id: "taylor", type: "person", name: "Example Colleague", person: { email: "taylor@example.com" } },
    });

    await expect(listNotionWorkspacePeople()).resolves.toEqual([
      { id: "taylor", name: "Example Colleague", email: "taylor@example.com" },
      { id: "alex", name: "Example User", email: "alex@example.com" },
    ]);
  });

  it("also picks people up from the Studio Projects Team property", async () => {
    route({
      "/users?": NO_PEOPLE,
      "/databases/projects-db/query": { results: [{ properties: { Team: { type: "people", people: [{ id: "tommy" }] } } }], has_more: false, next_cursor: null },
      "/users/tommy": { id: "tommy", type: "person", name: "Tommy Nam" },
    });

    await expect(listNotionWorkspacePeople()).resolves.toEqual([{ id: "tommy", name: "Tommy Nam" }]);
  });

  it("drops an account that no longer resolves instead of offering a blank row", async () => {
    route({
      "/users?": NO_PEOPLE,
      "/databases/schedule-db/query": { results: [{ properties: { Attendance: { type: "people", people: [{ id: "gone" }] } } }], has_more: false, next_cursor: null },
      "/users/gone": new Error("Notion API 404 Not Found"),
    });

    await expect(listNotionWorkspacePeople()).resolves.toEqual([]);
  });

  it("still lists members when a people source cannot be read", async () => {
    route({
      "/users?": { results: [{ id: "alex", type: "person", name: "Example User" }], has_more: false, next_cursor: null },
      "/databases/": new Error("Notion API 403 Forbidden"),
    });

    await expect(listNotionWorkspacePeople()).resolves.toEqual([{ id: "alex", name: "Example User" }]);
  });

  it("keeps two same-name accounts apart and answers a repeat call from cache", async () => {
    route({
      "/users?": NO_PEOPLE,
      "/databases/schedule-db/query": { results: [{ properties: { Attendance: { type: "people", people: [{ id: "upper" }, { id: "lower" }] } } }], has_more: false, next_cursor: null },
      "/users/upper": { id: "upper", type: "person", name: "Example Colleague", person: { email: "user@example.com" } },
      "/users/lower": { id: "lower", type: "person", name: "Example Colleague", person: { email: "user@example.com" } },
    });

    const first = await listNotionWorkspacePeople();
    expect(first.map((person) => person.email)).toEqual(["user@example.com", "user@example.com"]);
    const callCount = vi.mocked(notionFetch).mock.calls.length;
    await expect(listNotionWorkspacePeople()).resolves.toEqual(first);
    expect(vi.mocked(notionFetch).mock.calls.length).toBe(callCount);
  });
});
