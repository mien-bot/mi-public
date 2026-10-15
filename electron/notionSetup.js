const fs = require("node:fs");
const path = require("node:path");
const { atomicWriteJson } = require("./configStore");

const NOTION_VERSION = "2026-03-11";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_ATTEMPTS = 3;
const REQUIRED_PROPERTIES = {
  projects: {
    Name: ["title"],
    Status: ["status", "select"],
    Client: ["rich_text"],
    Location: ["rich_text"],
    "Project Type": ["multi_select"],
    Scope: ["multi_select"],
    Team: ["people"],
    "Total Hours": ["rollup", "formula", "number"],
  },
  schedule: {
    Name: ["title"],
    Date: ["date"],
    Type: ["multi_select"],
    Projects: ["relation"],
    Status: ["status", "select"],
    Attendance: ["people"],
  },
};

function sourceId(value) {
  const id = String(value || "").replace(/^collection:\/\//, "").replace(/-/g, "");
  if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error("Invalid Notion data source ID.");
  return id;
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers?.get?.("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter >= 0
    ? Math.min(retryAfter * 1_000, 10_000)
    : 250 * 2 ** attempt;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function notionRequest(fetchImpl, token, endpoint, init = {}) {
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetchImpl(`https://api.notion.com/v1${endpoint}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      if (attempt + 1 < MAX_REQUEST_ATTEMPTS) {
        await wait(250 * 2 ** attempt);
        continue;
      }
      throw new Error(`Notion request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (response.ok) return response.json();
    if ((response.status === 429 || response.status >= 500) && attempt + 1 < MAX_REQUEST_ATTEMPTS) {
      await wait(retryDelay(response, attempt));
      continue;
    }
    throw new Error(`Notion returned ${response.status} ${response.statusText}`.trim());
  }
  throw new Error("Notion request failed after retrying.");
}

function inspectSchema(properties, required) {
  if (!properties || typeof properties !== "object") {
    return { status: "not-reported", missing: [], incompatible: [] };
  }
  const missing = [];
  const incompatible = [];
  for (const [name, allowedTypes] of Object.entries(required)) {
    const property = properties[name];
    if (!property) missing.push(name);
    else if (!allowedTypes.includes(property.type)) {
      incompatible.push({ name, expected: allowedTypes, actual: property.type || "unknown" });
    }
  }
  return {
    status: missing.length === 0 && incompatible.length === 0 ? "compatible" : "incompatible",
    missing,
    incompatible,
  };
}

async function resolveDataSource(fetchImpl, token, configuredId, label) {
  const configured = sourceId(configuredId);
  try {
    return await notionRequest(fetchImpl, token, `/data_sources/${configured}`);
  } catch (dataSourceError) {
    try {
      const database = await notionRequest(fetchImpl, token, `/databases/${configured}`);
      const candidates = database.data_sources || [];
      const selected =
        candidates.find((candidate) => candidate.name?.toLowerCase() === label.toLowerCase()) ||
        (candidates.length === 1 ? candidates[0] : null);
      if (!selected) {
        throw new Error(`Database does not expose a unique "${label}" data source.`);
      }
      return await notionRequest(fetchImpl, token, `/data_sources/${sourceId(selected.id)}`);
    } catch (databaseError) {
      throw new Error(
        `${dataSourceError instanceof Error ? dataSourceError.message : String(dataSourceError)}; ` +
        `legacy database lookup also failed: ${
          databaseError instanceof Error ? databaseError.message : String(databaseError)
        }`,
      );
    }
  }
}

async function testSource(fetchImpl, token, configuredId, label, requiredProperties) {
  try {
    const database = await resolveDataSource(fetchImpl, token, configuredId, label);
    return {
      label,
      read: "available",
      id: database.id || sourceId(configuredId),
      schema: inspectSchema(database.properties, requiredProperties),
      error: null,
    };
  } catch (error) {
    return {
      label,
      read: "unavailable",
      id: null,
      schema: { status: "unavailable", missing: [], incompatible: [] },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeNotionSources({
  token,
  projectsDataSourceId,
  scheduleDataSourceId,
  fetchImpl = fetch,
}) {
  if (!token) throw new Error("No Notion token is stored.");
  const [projects, schedule] = await Promise.all([
    testSource(fetchImpl, token, projectsDataSourceId, "Studio Projects", REQUIRED_PROPERTIES.projects),
    testSource(fetchImpl, token, scheduleDataSourceId, "STUDIO Schedule", REQUIRED_PROPERTIES.schedule),
  ]);
  const readable = projects.read === "available" && schedule.read === "available";
  const compatible = projects.schema.status !== "incompatible" && schedule.schema.status !== "incompatible";
  return {
    projects,
    schedule,
    capabilities: {
      read: readable ? "available" : "unavailable",
      update: readable && compatible ? "configured-not-write-tested" : "unavailable",
      insert: readable && compatible ? "configured-not-write-tested" : "unavailable",
    },
    mutationCount: 0,
  };
}

function title(page) {
  for (const property of Object.values(page.properties || {})) {
    if (property.type === "title") return (property.title || []).map((item) => item.plain_text).join("");
  }
  return "(untitled)";
}

function status(page) {
  const value = page.properties?.Status;
  const name = (value?.status?.name || value?.select?.name || "").trim().toLowerCase();
  return {
    "not started": "not-started",
    "in progress": "in-progress",
    complete: "complete",
    abandoned: "abandoned",
  }[name] || "unknown";
}

function richText(page, propertyName) {
  const value = page.properties?.[propertyName];
  const parts = value?.type === "title" ? value.title : value?.rich_text;
  return (parts || []).map((item) => item.plain_text || "").join("").trim();
}

function names(page, propertyName) {
  const value = page.properties?.[propertyName];
  if (value?.type === "multi_select") return (value.multi_select || []).map((item) => item.name);
  if (value?.type === "people") {
    return (value.people || []).map((person) => person.name?.trim() || `notion-user:${person.id}`);
  }
  return [];
}

function numericValue(page, propertyName) {
  const value = page.properties?.[propertyName];
  if (!value) return 0;
  if (value.type === "number") return value.number || 0;
  if (value.type === "formula" && value.formula?.type === "number") return value.formula.number || 0;
  if (value.type === "rollup" && value.rollup?.type === "number") return value.rollup.number || 0;
  return 0;
}

function projectSlug(name, pageId) {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `notion-${String(pageId).replace(/-/g, "").slice(0, 12)}`;
}

function projectQuality(project) {
  const flags = [];
  if (project.status === "unknown") flags.push("missing-status");
  if (!project.client) flags.push("missing-client");
  if (!project.location) flags.push("missing-location");
  if (project.project_types.length === 0) flags.push("missing-project-type");
  if (project.scope.length === 0) flags.push("missing-scope");
  if (project.team.length === 0) flags.push("missing-team");
  return flags;
}

async function refreshProjectSnapshot({
  token,
  projectsDataSourceId,
  dataRoot,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const dataSource = await resolveDataSource(fetchImpl, token, projectsDataSourceId, "Studio Projects");
  const databaseId = sourceId(dataSource.id);
  const projects = [];
  let cursor;
  do {
    const response = await notionRequest(fetchImpl, token, `/data_sources/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    for (const page of response.results || []) {
      const name = title(page);
      const project = {
        mi_id: `mi:notion-project:${page.id}`,
        slug: projectSlug(name, page.id),
        notion_page_id: page.id,
        notion_url: page.url || `https://www.notion.so/${String(page.id).replace(/-/g, "")}`,
        name,
        status: status(page),
        client: richText(page, "Client") || null,
        location: richText(page, "Location") || null,
        project_types: names(page, "Project Type"),
        scope: names(page, "Scope"),
        team: names(page, "Team"),
        total_hours: numericValue(page, "Total Hours"),
        hours_by_person: {
          alex: numericValue(page, "Alex"),
          taylor: numericValue(page, "Taylor "),
        },
        schedule: { item_count: 0, calculated_hours: 0, latest_date: null, entries: [] },
        created_time: page.created_time || "",
        last_edited_time: page.last_edited_time || "",
      };
      projects.push({ ...project, data_quality: projectQuality(project) });
    }
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);

  const byStatus = {
    "not-started": 0,
    "in-progress": 0,
    complete: 0,
    abandoned: 0,
    unknown: 0,
  };
  for (const project of projects) byStatus[project.status]++;
  projects.sort((left, right) => left.name.localeCompare(right.name));

  const snapshot = {
    schema_version: 1,
    generated_at: now().toISOString(),
    sources: {
      projects: { id: databaseId, title: "Studio Projects", url: "" },
      schedule: null,
    },
    summary: {
      total_projects: projects.length,
      by_status: byStatus,
      total_reported_hours: projects.reduce((sum, project) => sum + project.total_hours, 0),
      linked_schedule_items: 0,
      projects_with_data_gaps: projects.filter((project) => project.data_quality.length > 0).length,
    },
    projects,
  };
  const target = path.join(dataRoot, "notion", "project-map.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  atomicWriteJson(target, snapshot);
  return { projectCount: projects.length, generatedAt: snapshot.generated_at };
}

function scheduleEntryStatus(page) {
  const value = page.properties?.Status;
  return value?.status?.name || value?.select?.name || null;
}

function isoDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Silently refreshes a bounded window of the firm-wide STUDIO Schedule (not filtered by
 * project) into data/notion/schedule-snapshot.json. Deliberately includes entries with no
 * Projects relation at all (PTO, internal-only blocks) -- that's exactly what "when am I
 * busy/free" chat context needs. Never touches project.yaml/schedule.yaml, same as
 * refreshProjectSnapshot above. Missing token/data-source configuration is a silent no-op,
 * matching runNotionSyncOnce's existing behavior in electron/desktopMain.js.
 */
async function refreshScheduleSnapshot({
  token,
  scheduleDataSourceId,
  dataRoot,
  fetchImpl = fetch,
  now = () => new Date(),
  windowDaysPast = 30,
  windowDaysFuture = 120,
}) {
  const dataSource = await resolveDataSource(fetchImpl, token, scheduleDataSourceId, "STUDIO Schedule");
  const databaseId = sourceId(dataSource.id);
  const today = now();
  const from = isoDateOnly(new Date(today.getTime() - windowDaysPast * 86_400_000));
  const to = isoDateOnly(new Date(today.getTime() + windowDaysFuture * 86_400_000));
  const entries = [];
  let cursor;
  do {
    const response = await notionRequest(fetchImpl, token, `/data_sources/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        start_cursor: cursor,
        // Compound `and` of two single-condition filters, not two keys on one date
        // filter object -- Notion silently drops on_or_after when combined that way
        // (confirmed live 2026-07-27; see src/adapters/notion/schedule.ts's identical fix).
        filter: {
          and: [
            { property: "Date", date: { on_or_after: from } },
            { property: "Date", date: { on_or_before: to } },
          ],
        },
      }),
    });
    for (const page of response.results || []) {
      entries.push({
        notion_page_id: page.id,
        name: title(page),
        date: page.properties?.Date?.date?.start ?? null,
        date_end: page.properties?.Date?.date?.end ?? null,
        start_time: page.properties?.["Start Time"]?.date?.start ?? null,
        end_time: page.properties?.["End Time"]?.date?.start ?? null,
        last_edited_time: page.last_edited_time || null,
        type: (page.properties?.Type?.multi_select ?? []).map((t) => t.name),
        status: scheduleEntryStatus(page),
        hours: page.properties?.["Hours Manual"]?.number ?? null,
        attendees: (page.properties?.Attendance?.people ?? []).map((p) => ({ id: p.id, name: p.name?.trim() || null })),
        project_page_ids: (page.properties?.Projects?.relation ?? []).map((r) => r.id),
      });
    }
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);

  const snapshot = { schema_version: 3, generated_at: now().toISOString(), window: { from, to }, entries };
  const target = path.join(dataRoot, "notion", "schedule-snapshot.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  atomicWriteJson(target, snapshot);
  return { entryCount: entries.length, generatedAt: snapshot.generated_at, window: snapshot.window };
}

module.exports = { NOTION_VERSION, probeNotionSources, refreshProjectSnapshot, refreshScheduleSnapshot, sourceId };
