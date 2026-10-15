/**
 * One-off, explicitly authorized schema change: adds the properties Mi's
 * lead sync (src/adapters/notion/leads.ts) needs but the live Notion
 * "Leads" database doesn't have yet — Dropbox Folder, Last Site Visit,
 * Contract Stage, Contract Notes, Meeting Notes, Referred By. Additive
 * only: never removes or renames an existing property, and skips any
 * property that already exists (safe to re-run).
 *
 * Usage: npx tsx scripts/notion-leads-schema.ts
 */
export {}; // forces module scope so top-level `const token` doesn't collide with scripts/notion-probe.ts under tsc's whole-project check

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local not found — NOTION_API_KEY/NOTION_LEADS_DATABASE_ID may already be in the environment.
}

const token = process.env.NOTION_API_KEY;
const databaseId = process.env.NOTION_LEADS_DATABASE_ID;
if (!token) {
  console.error("NOTION_API_KEY not set — add it to .env.local first.");
  process.exit(1);
}
if (!databaseId) {
  console.error("NOTION_LEADS_DATABASE_ID not set — add it to .env.local first.");
  process.exit(1);
}

const NOTION_VERSION = "2022-06-28";

async function notion<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Notion API error: ${res.status} ${res.statusText}\n${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface NotionDatabase {
  properties: Record<string, { type: string }>;
}

const NEW_PROPERTIES: Record<string, unknown> = {
  "Dropbox Folder": { rich_text: {} },
  "Last Site Visit": { date: {} },
  "Contract Stage": {
    select: {
      options: [
        { name: "Not Sent" },
        { name: "Sent" },
        { name: "Under Negotiation" },
        { name: "Signed" },
      ],
    },
  },
  "Contract Notes": { rich_text: {} },
  "Meeting Notes": { rich_text: {} },
  "Referred By": { rich_text: {} },
};

async function main() {
  const database = await notion<NotionDatabase>(`/databases/${databaseId}`);
  const existing = new Set(Object.keys(database.properties));

  const toAdd = Object.fromEntries(
    Object.entries(NEW_PROPERTIES).filter(([name]) => !existing.has(name)),
  );

  if (Object.keys(toAdd).length === 0) {
    console.log("All five properties already exist on the Leads database — nothing to do.");
    return;
  }

  console.log("Adding properties:", Object.keys(toAdd).join(", "));
  await notion(`/databases/${databaseId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: toAdd }),
  });
  console.log("Done.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
