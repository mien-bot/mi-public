const NOTION_VERSION = "2026-03-11";
const REQUEST_TIMEOUT_MS = 15_000;

function normalizedId(value, label = "Notion data source") {
  const id = String(value || "").replace(/^collection:\/\//, "").replace(/-/g, "");
  if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error(`${label} ID is invalid.`);
  return id;
}

async function notionRequest(fetchImpl, token, endpoint, init = {}) {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Store a personal Notion integration token first.");
  }
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
    throw new Error(`Personal Notion request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Personal Notion returned ${response.status} ${response.statusText}`.trim());
  }
  return response.json();
}

function titleText(value) {
  return (value || []).map((part) => part?.plain_text || part?.text?.content || "").join("").trim();
}

function calendarOption(source) {
  const properties = source?.properties && typeof source.properties === "object" ? source.properties : {};
  const titleProperties = Object.entries(properties)
    .filter(([, property]) => property?.type === "title")
    .map(([name]) => name);
  const dateProperties = Object.entries(properties)
    .filter(([, property]) => property?.type === "date")
    .map(([name]) => name);
  const name = titleText(source.title) || source.name?.trim() || "Untitled calendar";
  return {
    id: normalizedId(source.id),
    name,
    titleProperties,
    dateProperties,
    compatible: titleProperties.length === 1 && dateProperties.length > 0,
  };
}

async function listPersonalCalendars({ token, fetchImpl = fetch }) {
  const calendars = [];
  let cursor;
  do {
    const result = await notionRequest(fetchImpl, token, "/search", {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        start_cursor: cursor,
        sort: { direction: "descending", timestamp: "last_edited_time" },
      }),
    });
    for (const item of result.results || []) {
      if (item.object !== "data_source") continue;
      calendars.push(calendarOption(item));
    }
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return calendars.sort((left, right) => left.name.localeCompare(right.name));
}

function validateCalendarSelection(calendar, selection) {
  if (!calendar || calendar.id !== normalizedId(selection?.dataSourceId)) {
    throw new Error("Select a calendar returned by this personal Notion connection.");
  }
  if (!calendar.titleProperties.includes(selection.titleProperty)) {
    throw new Error("Select the calendar's title property.");
  }
  if (!calendar.dateProperties.includes(selection.dateProperty)) {
    throw new Error("Select a date property from that calendar.");
  }
  return {
    personalCalendarDataSourceId: calendar.id,
    personalCalendarName: calendar.name,
    personalCalendarTitleProperty: selection.titleProperty,
    personalCalendarDateProperty: selection.dateProperty,
  };
}

function personalCalendarProperties(input, settings) {
  if (!input?.name?.trim() || !input?.date) throw new Error("Review the calendar title and date first.");
  const start = input.startTime || input.date;
  return {
    [settings.personalCalendarTitleProperty]: {
      title: [{ text: { content: input.name.trim().slice(0, 200) } }],
    },
    [settings.personalCalendarDateProperty]: {
      date: { start, end: input.endTime || null },
    },
  };
}

async function createPersonalCalendarEntry({ token, settings, input, fetchImpl = fetch }) {
  const dataSourceId = normalizedId(settings?.personalCalendarDataSourceId);
  if (!settings?.personalCalendarTitleProperty || !settings?.personalCalendarDateProperty) {
    throw new Error("Select and save a personal Notion calendar first.");
  }
  const created = await notionRequest(fetchImpl, token, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties: personalCalendarProperties(input, settings),
    }),
  });
  if (!created?.id || !created?.url) throw new Error("Personal Notion did not return the created page.");
  return { id: created.id, url: created.url };
}

module.exports = {
  NOTION_VERSION,
  calendarOption,
  createPersonalCalendarEntry,
  listPersonalCalendars,
  normalizedId,
  personalCalendarProperties,
  validateCalendarSelection,
};
