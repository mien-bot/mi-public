/**
 * Read-only Notion inventory. Paginates the integration's complete search
 * result instead of silently stopping at the first 100 visible objects.
 *
 * Usage:
 *   npm run notion-probe
 *   npm run notion-probe -- --pages
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

interface NotionRichText {
  plain_text: string;
}

export interface NotionSearchResult {
  object: "database" | "page";
  id: string;
  url: string;
  title?: NotionRichText[];
  properties?: Record<string, { type: string; title?: NotionRichText[] }>;
}

interface NotionSearchResponse {
  results: NotionSearchResult[];
  has_more: boolean;
  next_cursor: string | null;
}

function extractTitle(result: NotionSearchResult): string {
  if (result.object === "database") {
    return (result.title ?? []).map((item) => item.plain_text).join("") || "(untitled database)";
  }
  for (const property of Object.values(result.properties ?? {})) {
    if (property.type === "title") {
      return (property.title ?? []).map((item) => item.plain_text).join("") || "(untitled page)";
    }
  }
  return "(untitled page)";
}

export async function searchAllNotionObjects(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NotionSearchResult[]> {
  const results: NotionSearchResult[] = [];
  let cursor: string | null = null;
  do {
    const response = await fetchImpl("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`Notion API ${response.status} ${response.statusText}`.trim());
    }
    const page = (await response.json()) as NotionSearchResponse;
    results.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return results;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.some((arg) => !["--pages", "--help", "-h"].includes(arg))) {
    throw new Error('Usage: npm run notion-probe -- [--pages]');
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write("Usage: npm run notion-probe -- [--pages]\n");
    return 0;
  }
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // NOTION_API_KEY may already be supplied by the parent process.
  }
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error("NOTION_API_KEY is not set.");

  const results = await searchAllNotionObjects(token);
  const databases = results.filter((result) => result.object === "database");
  const pages = results.filter((result) => result.object === "page");

  process.stdout.write(
    `${databases.length} database(s) and ${pages.length} page(s) are shared with this integration.\n\n`,
  );
  for (const database of databases) {
    process.stdout.write(
      `- [database] "${extractTitle(database)}"\n  id: ${database.id}\n  url: ${database.url}\n`,
    );
  }
  if (argv.includes("--pages")) {
    process.stdout.write(`\n${pages.length} page(s):\n\n`);
    for (const page of pages) {
      process.stdout.write(
        `- [page] "${extractTitle(page)}"\n  id: ${page.id}\n  url: ${page.url}\n`,
      );
    }
  } else {
    process.stdout.write("\nPage details omitted. Re-run with --pages to list them.\n");
  }
  return 0;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
