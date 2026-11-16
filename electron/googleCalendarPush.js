const crypto = require("node:crypto");
const googleCalendar = require("./googleCalendar");

/** Work sessions stay out: the shared calendar is for what others need to see. */
const SENT_TYPES = new Set(["Deadline", "Midterm Deadline", "Kick-off", "Meeting", "Client Meeting", "Internal Meeting"]);
const ONE_HOUR_MS = 3_600_000;

const nextDay = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Project work only. An entry with no project may be personal, so it never leaves Mi. */
function isSendable(entry, today) {
  return Boolean(entry.date)
    && entry.date.slice(0, 10) >= today
    && (entry.project_page_ids ?? []).length > 0
    && (entry.type ?? []).some((type) => SENT_TYPES.has(type));
}

/** Guests are left out on purpose, so sending never emails anyone. */
function buildEvent(entry) {
  const timed = entry.date.includes("T");
  const start = timed ? { dateTime: entry.date } : { date: entry.date };
  const end = timed
    ? { dateTime: entry.date_end?.includes("T") ? entry.date_end : new Date(Date.parse(entry.date) + ONE_HOUR_MS).toISOString() }
    : { date: nextDay((entry.date_end ?? entry.date).slice(0, 10)) };
  return { summary: entry.name, description: "Added by Mi from STUDIO Schedule.", start, end };
}

const hashOf = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Stable for one schedule item, so a retry finds the same event instead of adding a second. */
const eventIdFor = (sourceId) => `mi${hashOf(["mi-schedule", sourceId]).slice(0, 40)}`;

function whenLabel(event) {
  return event.start?.dateTime ?? event.start?.date ?? "";
}

function planPush({ entries, managed, today }) {
  const existing = new Map(managed.map((event) => [event.source, event]));
  const desired = new Map();
  for (const entry of entries) {
    if (!isSendable(entry, today)) continue;
    const event = buildEvent(entry);
    desired.set(entry.notion_page_id, { event, hash: hashOf(event) });
  }
  const adds = [];
  const updates = [];
  for (const [source, { event, hash }] of desired) {
    const current = existing.get(source);
    if (!current) adds.push({ action: "add", id: eventIdFor(source), source, hash, event, name: event.summary, when: whenLabel(event) });
    else if (current.hash !== hash) updates.push({ action: "update", id: current.id, source, hash, event, name: event.summary, when: whenLabel(event) });
  }
  // A past event stays as history. Only something still ahead can be taken back off.
  const removals = managed
    .filter((event) => !desired.has(event.source) && event.when.slice(0, 10) >= today)
    .map((event) => ({ action: "remove", id: event.id, source: event.source, name: event.name, when: event.when }));
  return { adds, updates, removals };
}

const planAllRemovals = (managed) => ({
  adds: [],
  updates: [],
  removals: managed.map((event) => ({ action: "remove", id: event.id, source: event.source, name: event.name, when: event.when })),
});

function fingerprint(plan) {
  return hashOf([...plan.adds, ...plan.updates, ...plan.removals].map((item) => [item.action, item.id, item.hash ?? ""]));
}

function tagged(item) {
  return { ...item.event, extendedProperties: { private: { miManaged: "1", miSource: item.source, miHash: item.hash } } };
}

/** One at a time, reporting each. A failure stops nothing else, and nothing is rolled back. */
async function applyPlan({ plan, token, calendarId, fetchImpl }) {
  const results = [];
  const request = { token, calendarId, fetchImpl };
  for (const item of [...plan.adds, ...plan.updates, ...plan.removals]) {
    try {
      if (item.action === "add") {
        await googleCalendar.insertEvent({ ...request, id: item.id, event: tagged(item) });
      } else if (item.action === "update") {
        await googleCalendar.updateManagedEvent({ ...request, id: item.id, event: tagged(item) });
      } else {
        await googleCalendar.deleteManagedEvent({ ...request, id: item.id });
      }
      results.push({ name: item.name, action: item.action, status: "done" });
    } catch (error) {
      results.push({ name: item.name, action: item.action, status: "failed", error: error instanceof Error ? error.message : "Google refused this change." });
    }
  }
  return results;
}

module.exports = { SENT_TYPES, applyPlan, buildEvent, eventIdFor, fingerprint, isSendable, planAllRemovals, planPush };
