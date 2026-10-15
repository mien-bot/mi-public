import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildProjectMap,
  renderProjectMapMarkdown,
  type NotionPage,
} from "../lib/notion/projectMap";
import { normalizeNotionId } from "../src/adapters/notion/ids";
import {
  readCurrentHash,
  writeFileAtomically,
} from "../lib/content/atomicContentWrite";

const NOTION_VERSION = "2026-03-11";
const DEFAULT_PROJECTS_TITLE = "Studio Projects";
const DEFAULT_SCHEDULE_TITLE = "STUDIO Schedule";

interface DataSourceReference {
  object: "data_source";
  id: string;
  url: string;
  title?: Array<{ plain_text: string }>;
}

interface SearchResponse {
  results: Array<DataSourceReference | { object: string }>;
  has_more: boolean;
  next_cursor: string | null;
}

interface DatabaseResponse {
  id: string;
  url: string;
  data_sources?: Array<{ id: string; name: string }>;
}

interface QueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

interface MapOptions {
  write: boolean;
  json: boolean;
  envFile: string;
  projectsDatabaseId?: string;
  scheduleDatabaseId?: string;
}

const HELP = `Map projects from the Notion API

Usage:
  mi notion map [options]

Options:
  --write                  Write notion/project-map.json and docs/notion-project-map.md
  --json                   Print normalized JSON instead of Markdown
  --env-file <path>        Environment file (default: .env.local)
  --projects-db <id>       Override/disambiguate the Studio Projects database
  --schedule-db <id>       Override/disambiguate the STUDIO Schedule database
  -h, --help               Show this help

Environment:
  NOTION_API_KEY                 Required integration token
  NOTION_PROJECTS_DATA_SOURCE_ID Optional project data-source override
  NOTION_SCHEDULE_DATA_SOURCE_ID Optional schedule data-source override
  NOTION_PROJECTS_DATABASE_ID    Legacy/container project ID override
  NOTION_SCHEDULE_DATABASE_ID    Legacy/container schedule ID override

This command is read-only in Notion. Local files are written only with --write.
`;

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseMapArgs(argv: string[]): MapOptions | { help: true } {
  const options: MapOptions = {
    write: false,
    json: false,
    envFile: ".env.local",
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--env-file") {
      options.envFile = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg === "--projects-db") {
      options.projectsDatabaseId = requireValue(argv, index, arg);
      index++;
      continue;
    }
    if (arg === "--schedule-db") {
      options.scheduleDatabaseId = requireValue(argv, index, arg);
      index++;
      continue;
    }
    throw new Error(`Unknown option "${arg}".`);
  }
  return options;
}

function dataSourceTitle(dataSource: DataSourceReference): string {
  return (dataSource.title ?? []).map((item) => item.plain_text).join("").trim();
}

async function notionRequest<T>(
  token: string,
  endpoint: string,
  init: RequestInit = {},
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (response.ok) return (await response.json()) as T;
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter)
        ? Math.min(retryAfter * 1_000, 10_000)
        : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    let detail = "";
    try {
      const body = await response.json() as { code?: string; message?: string };
      detail = [body.code, body.message].filter(Boolean).join(": ");
    } catch {
      detail = response.statusText;
    }
    throw new Error(
      `Notion API ${response.status} ${response.statusText} for ${endpoint}` +
        (detail ? `: ${detail}` : ""),
    );
  }
  throw new Error(`Notion request failed after retrying: ${endpoint}`);
}

async function listDataSources(token: string): Promise<DataSourceReference[]> {
  const dataSources: DataSourceReference[] = [];
  let cursor: string | null = null;
  do {
    const response: SearchResponse = await notionRequest<SearchResponse>(
      token,
      "/search",
      {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        filter: { property: "object", value: "data_source" },
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
      },
    );
    dataSources.push(
      ...response.results.filter(
        (result): result is DataSourceReference => result.object === "data_source",
      ),
    );
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);
  return dataSources;
}

async function selectDataSource(
  token: string,
  dataSources: DataSourceReference[],
  title: string,
  explicitId: string | undefined,
): Promise<DataSourceReference> {
  if (explicitId) {
    const normalized = normalizeNotionId(explicitId, "Notion database/data-source ID");
    const match = dataSources.find(
      (dataSource) => normalizeNotionId(dataSource.id) === normalized,
    );
    if (match) return match;

    // Accept a database-container ID for compatibility, then resolve its
    // single matching data source through the current Notion API.
    const database = await notionRequest<DatabaseResponse>(
      token,
      `/databases/${normalized}`,
    );
    const candidates = database.data_sources ?? [];
    const selected =
      candidates.find(
        (candidate) =>
          candidate.name.toLocaleLowerCase() === title.toLocaleLowerCase(),
      ) ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!selected) {
      throw new Error(
        `Database ${explicitId} does not expose a unique "${title}" data source.`,
      );
    }
    return {
      object: "data_source",
      id: selected.id,
      title: [{ plain_text: selected.name }],
      url: database.url,
    };
  }

  const matches = dataSources.filter(
    (dataSource) =>
      dataSourceTitle(dataSource).toLocaleLowerCase() === title.toLocaleLowerCase(),
  );
  if (matches.length === 0) {
    throw new Error(
      `No shared Notion data source named "${title}" was found. ` +
        "Share it with the integration or pass an explicit database ID.",
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple shared databases are named "${title}". Pass an explicit database ID.`,
    );
  }
  return matches[0];
}

async function queryDataSource(
  token: string,
  dataSourceId: string,
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | null = null;
  do {
    const response: QueryResponse = await notionRequest<QueryResponse>(
      token,
      `/data_sources/${dataSourceId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);
  return pages;
}

function loadEnvironment(envFile: string): void {
  const resolved = path.resolve(envFile);
  if (!fs.existsSync(resolved)) {
    if (!process.env.NOTION_API_KEY) {
      throw new Error(
        `Environment file not found: ${resolved}. Pass --env-file or set NOTION_API_KEY.`,
      );
    }
    return;
  }
  process.loadEnvFile(resolved);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseMapArgs(argv);
  if ("help" in parsed) {
    process.stdout.write(HELP);
    return 0;
  }

  loadEnvironment(parsed.envFile);
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error("NOTION_API_KEY is not set.");

  const dataSources = await listDataSources(token);
  const projectDataSource = await selectDataSource(
    token,
    dataSources,
    DEFAULT_PROJECTS_TITLE,
    parsed.projectsDatabaseId ??
      process.env.NOTION_PROJECTS_DATA_SOURCE_ID ??
      process.env.NOTION_PROJECTS_DATABASE_ID,
  );
  const scheduleDataSource = await selectDataSource(
    token,
    dataSources,
    DEFAULT_SCHEDULE_TITLE,
    parsed.scheduleDatabaseId ??
      process.env.NOTION_SCHEDULE_DATA_SOURCE_ID ??
      process.env.NOTION_SCHEDULE_DATABASE_ID,
  );

  const [projectPages, schedulePages] = await Promise.all([
    queryDataSource(token, projectDataSource.id),
    queryDataSource(token, scheduleDataSource.id),
  ]);
  const map = buildProjectMap({
    generatedAt: new Date().toISOString(),
    projectSource: {
      id: projectDataSource.id,
      title: dataSourceTitle(projectDataSource),
      url: projectDataSource.url,
    },
    scheduleSource: {
      id: scheduleDataSource.id,
      title: dataSourceTitle(scheduleDataSource),
      url: scheduleDataSource.url,
    },
    projectPages,
    schedulePages,
  });
  const markdown = renderProjectMapMarkdown(map);

  if (parsed.write) {
    const repoRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const jsonPath = path.join(repoRoot, "notion", "project-map.json");
    const markdownPath = path.join(repoRoot, "docs", "notion-project-map.md");
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
    const jsonHash = readCurrentHash(jsonPath);
    const markdownHash = readCurrentHash(markdownPath);
    writeFileAtomically(jsonPath, `${JSON.stringify(map, null, 2)}\n`, {
      expectedHash: jsonHash,
    });
    writeFileAtomically(markdownPath, markdown, {
      expectedHash: markdownHash,
    });
    process.stdout.write(
      `Mapped ${map.summary.total_projects} projects and ` +
        `${map.summary.linked_schedule_items} linked schedule items.\n` +
        `Wrote ${path.relative(repoRoot, jsonPath)}\n` +
        `Wrote ${path.relative(repoRoot, markdownPath)}\n`,
    );
    return 0;
  }

  process.stdout.write(parsed.json ? `${JSON.stringify(map, null, 2)}\n` : markdown);
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
