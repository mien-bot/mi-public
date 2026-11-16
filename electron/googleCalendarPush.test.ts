import { describe, expect, it } from "vitest";
import googleCalendar from "./googleCalendar";
import push from "./googleCalendarPush";

const today = "2026-11-01";
const entry = (id: string, name: string, date: string, type: string[], extra: object = {}) => ({
  notion_page_id: id, name, date, date_end: null, type, project_page_ids: ["project"], ...extra,
});

/** Stands in for one Google calendar, including events a person made. */
function fakeGoogle(initial: Record<string, unknown>[] = []) {
  const events = new Map(initial.map((event) => [event.id as string, event]));
  const calls: string[] = [];
  const respond = (status: number, body: unknown = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status });
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    const method = init?.method ?? "GET";
    const id = decodeURIComponent(parsed.pathname.split("/events/")[1] ?? "");
    calls.push(`${method} ${id}`);
    if (method === "GET" && !id) {
      const managedOnly = parsed.searchParams.get("privateExtendedProperty") === "miManaged=1";
      const items = [...events.values()].filter((event) => !managedOnly || (event as { extendedProperties?: { private?: { miManaged?: string } } }).extendedProperties?.private?.miManaged === "1");
      return respond(200, { items });
    }
    if (method === "GET") return events.has(id) ? respond(200, events.get(id)) : respond(404);
    if (method === "POST") {
      const body = JSON.parse(String(init?.body));
      if (events.has(body.id)) return respond(409);
      events.set(body.id, body);
      return respond(200, body);
    }
    if (method === "PUT") {
      if (!events.has(id)) return respond(404);
      events.set(id, { ...JSON.parse(String(init?.body)), id });
      return respond(200, {});
    }
    if (method === "DELETE") return events.delete(id) ? respond(204) : respond(404);
    return respond(400);
  };
  return { events, calls, fetchImpl: fetchImpl as typeof fetch };
}

const request = (fake: ReturnType<typeof fakeGoogle>) => ({ token: "t", calendarId: "shared", fetchImpl: fake.fetchImpl });

describe("sending to a shared Google calendar", () => {
  it("sends project milestones and meetings, and nothing else", () => {
    const { adds } = push.planPush({ today, managed: [], entries: [
      entry("a", "Permit deadline", "2026-11-05", ["Deadline"]),
      entry("b", "Client meeting", "2026-11-06T10:00:00.000-06:00", ["Client Meeting"]),
      entry("c", "Daily block", "2026-11-06", ["Work Session"]),
      entry("d", "Dentist", "2026-11-06", ["Meeting"], { project_page_ids: [] }),
      entry("e", "Old deadline", "2026-10-01", ["Deadline"]),
      entry("f", "No date", null as unknown as string, ["Deadline"]),
    ] });
    expect(adds.map((item) => item.name)).toEqual(["Permit deadline", "Client meeting"]);
  });

  it("shapes all-day and timed events, with no guests", () => {
    expect(push.buildEvent(entry("a", "Due", "2026-11-05", ["Deadline"]))).toMatchObject({ start: { date: "2026-11-05" }, end: { date: "2026-11-06" } });
    const timed = push.buildEvent(entry("b", "Meet", "2026-11-05T10:00:00.000-06:00", ["Meeting"]));
    expect(timed.end.dateTime).toBe("2026-11-05T17:00:00.000Z");
    expect(timed).not.toHaveProperty("attendees");
  });

  it("creates, then has nothing left to do, then updates and removes only its own events", async () => {
    const human = { id: "human", summary: "Lunch with client", start: { date: "2026-11-05" }, end: { date: "2026-11-06" } };
    const fake = fakeGoogle([human]);
    const entries = [entry("a", "Permit deadline", "2026-11-05", ["Deadline"]), entry("b", "Kickoff", "2026-11-09", ["Kick-off"])];
    const first = push.planPush({ today, entries, managed: await googleCalendar.listManagedEvents(request(fake)) });
    await push.applyPlan({ ...request(fake), plan: first });
    expect(fake.events.size).toBe(3);

    const again = push.planPush({ today, entries, managed: await googleCalendar.listManagedEvents(request(fake)) });
    expect([...again.adds, ...again.updates, ...again.removals]).toEqual([]);

    const changed = push.planPush({ today, entries: [{ ...entries[0], date: "2026-11-07" }], managed: await googleCalendar.listManagedEvents(request(fake)) });
    expect(changed.updates).toHaveLength(1);
    expect(changed.removals.map((item: { name: string }) => item.name)).toEqual(["Kickoff"]);
    await push.applyPlan({ ...request(fake), plan: changed });
    expect(fake.events.get("human")).toEqual(human);
    expect(fake.events.size).toBe(2);

    await push.applyPlan({ ...request(fake), plan: push.planAllRemovals(await googleCalendar.listManagedEvents(request(fake))) });
    expect([...fake.events.keys()]).toEqual(["human"]);
    expect(fake.calls.filter((call) => call.endsWith(" human"))).toEqual([]);
  });

  it("refuses to change an event without Mi's tag, even when asked for it by id", async () => {
    const fake = fakeGoogle([{ id: "human", summary: "Lunch" }]);
    await expect(googleCalendar.updateManagedEvent({ ...request(fake), id: "human", event: { summary: "x" } })).rejects.toThrow(/did not add/);
    await expect(googleCalendar.deleteManagedEvent({ ...request(fake), id: "human" })).rejects.toThrow(/did not add/);
    expect(fake.events.get("human")).toEqual({ id: "human", summary: "Lunch" });
  });

  it("adopts its own event on a retry, instead of adding a second one", async () => {
    const fake = fakeGoogle();
    const plan = push.planPush({ today, managed: [], entries: [entry("a", "Due", "2026-11-05", ["Deadline"])] });
    await push.applyPlan({ ...request(fake), plan });
    const results = await push.applyPlan({ ...request(fake), plan });
    expect(results[0].status).toBe("done");
    expect(fake.events.size).toBe(1);
  });

  it("reports each failure and carries on", async () => {
    const fake = fakeGoogle();
    const failing = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(init.body).includes("Bad")) return new Response("{}", { status: 403 });
      return fake.fetchImpl(url, init);
    }) as typeof fetch;
    const plan = push.planPush({ today, managed: [], entries: [entry("a", "Bad", "2026-11-05", ["Deadline"]), entry("b", "Good", "2026-11-06", ["Deadline"])] });
    const results = await push.applyPlan({ token: "t", calendarId: "shared", plan, fetchImpl: failing });
    expect(results.map((result) => result.status)).toEqual(["failed", "done"]);
    expect(fake.events.size).toBe(1);
  });

  it("keeps past events as history, and a changed plan changes the fingerprint", () => {
    const managed = [{ id: "m", source: "gone", hash: "h", name: "Past", when: "2026-10-01" }];
    const none = push.planPush({ today, managed, entries: [] });
    expect(none.removals).toEqual([]);
    const later = push.planPush({ today, managed: [{ ...managed[0], when: "2026-12-01" }], entries: [] });
    expect(push.fingerprint(later)).not.toBe(push.fingerprint(none));
  });
});
