import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildProjectProperties,
  parseProjectWriteArgs,
  resolveProjectTarget,
  type WritableProjectSchema,
} from "../lib/notion/projectWrite";
import type { NotionPage } from "../lib/notion/projectMap";
import { recordAudit } from "../src/audit/log";

const NOTION_VERSION = "2026-03-11";
const PROJECTS_TITLE = "Studio Projects";

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

interface QueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

interface DataSourceSchemaResponse {
  id: string;
  properties: Record<
    string,
    {
      type: string;
      status?: { options?: Array<{ name: string }> };
      multi_select?: { options?: Array<{ name: string }> };
    }
  >;
}

const HELP = `Write Studio projects through the Notion API

Usage:
  mi notion project create --name <name> [fields] [--apply]
  mi notion project update <page-id|exact-name|slug> [fields] [--apply]

Writable fields:
  --name <value>
  --status <not-started|in-progress|complete|abandoned>
  --client <value> | --clear-client
  --location <value> | --clear-location
  --project-type <value[,value]> | --clear-project-types
  --scope <value[,value]> | --clear-scope

Safety and connection:
  --expected-last-edited <ISO timestamp>  Reject a stale update
  --projects-source <data-source-id>      Override title discovery
  --env-file <path>                       Environment file (default: .env.local)
  --apply                                 Perform the write; otherwise preview only
  -h, --help                              Show this help

Only existing Notion status, project-type, and scope options are accepted. Formula,
rollup, relation, and people fields are not writable through this command.
`;

async function notionRequest<T>(
  token: string,
  endpoint: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 403) {
      throw new Error(
        "Notion denied the write. Enable Insert content and Update content for " +
          `this integration, then retry. API detail: ${detail}`,
      );
    }
    throw new Error(
      `Notion API ${response.status} ${response.statusText} for ${endpoint}: ${detail}`,
    );
  }
  return (await response.json()) as T;
}

function loadEnvironment(envFile: string): void {
  const resolved = path.resolve(envFile);
  if (fs.existsSync(resolved)) process.loadEnvFile(resolved);
  if (!process.env.NOTION_API_KEY) {
    throw new Error(
      `NOTION_API_KEY is not set. Environment file checked: ${resolved}`,
    );
  }
}

function sourceTitle(source: DataSourceReference): string {
  return (source.title ?? []).map((part) => part.plain_text).join("").trim();
}

async function findProjectsSource(
  token: string,
  explicitId: string | undefined,
): Promise<DataSourceReference> {
  const sources: DataSourceReference[] = [];
  let cursor: string | null = null;
  do {
    const response: SearchResponse = await notionRequest(token, "/search", {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        filter: { property: "object", value: "data_source" },
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    sources.push(
      ...response.results.filter(
        (result): result is DataSourceReference => result.object === "data_source",
      ),
    );
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);

  const normalizedExplicit = explicitId?.replaceAll("-", "").toLocaleLowerCase();
  const matches = sources.filter((source) =>
    normalizedExplicit
      ? source.id.replaceAll("-", "").toLocaleLowerCase() === normalizedExplicit
      : sourceTitle(source).toLocaleLowerCase() === PROJECTS_TITLE.toLocaleLowerCase(),
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "The Studio Projects data source is not visible to this integration."
        : "Multiple Studio Projects data sources matched. Pass --projects-source.",
    );
  }
  return matches[0];
}

async function queryProjects(token: string, dataSourceId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | null = null;
  do {
    const response: QueryResponse = await notionRequest(
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

async function writableSchema(
  token: string,
  dataSourceId: string,
): Promise<WritableProjectSchema> {
  const source = await notionRequest<DataSourceSchemaResponse>(
    token,
    `/data_sources/${dataSourceId}`,
  );
  const schema: WritableProjectSchema = {};
  for (const [name, property] of Object.entries(source.properties)) {
    schema[name] = {
      type: property.type,
      options:
        property.status?.options?.map((option) => option.name) ??
        property.multi_select?.options?.map((option) => option.name),
    };
  }
  return schema;
}

function auditWrite(repoRoot: string, record: object): string {
  const auditDir = path.join(repoRoot, ".mi", "audit");
  fs.mkdirSync(auditDir, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const auditPath = path.join(auditDir, `${timestamp}-notion-project-write.json`);
  fs.writeFileSync(auditPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return path.relative(repoRoot, auditPath);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }

  const options = parseProjectWriteArgs(argv);
  loadEnvironment(options.envFile);
  const token = process.env.NOTION_API_KEY as string;
  const source = await findProjectsSource(
    token,
    options.projectsDataSourceId ??
      process.env.NOTION_PROJECTS_DATA_SOURCE_ID,
  );
  const schema = await writableSchema(token, source.id);
  const properties = buildProjectProperties(options, schema);
  const pages =
    options.mode === "update" ? await queryProjects(token, source.id) : [];
  const target =
    options.mode === "update"
      ? resolveProjectTarget(pages, options.target as string)
      : null;

  if (
    target &&
    options.expectedLastEditedTime &&
    target.last_edited_time !== options.expectedLastEditedTime
  ) {
    throw new Error(
      `Conflict: project was last edited ${target.last_edited_time}, not ` +
        `${options.expectedLastEditedTime}. Refresh the map and review the change.`,
    );
  }

  const plan = {
    mode: options.mode,
    apply: options.apply,
    data_source: { id: source.id, title: sourceTitle(source), url: source.url },
    target: target
      ? {
          id: target.id,
          url: target.url,
          last_edited_time: target.last_edited_time,
        }
      : null,
    properties,
  };
  if (!options.apply) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.stderr.write("Preview only. Re-run with --apply to write to Notion.\n");
    return 0;
  }

  const result =
    options.mode === "create"
      ? await notionRequest<NotionPage>(token, "/pages", {
          method: "POST",
          body: JSON.stringify({
            parent: { type: "data_source_id", data_source_id: source.id },
            properties,
          }),
        })
      : await notionRequest<NotionPage>(token, `/pages/${target?.id}`, {
          method: "PATCH",
          body: JSON.stringify({ properties }),
        });

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const auditPath = auditWrite(repoRoot, {
    timestamp: new Date().toISOString(),
    action: `notion.project.${options.mode}`,
    data_source_id: source.id,
    requested_properties: properties,
    previous:
      target === null
        ? null
        : {
            page_id: target.id,
            last_edited_time: target.last_edited_time,
          },
    result: {
      page_id: result.id,
      url: result.url,
      last_edited_time: result.last_edited_time,
    },
  });
  // Also feed the single shared Notion-mutation log (.mi/audit/notion-sync.log) so every
  // write path — CLI, status route, schedule route — is visible in one place, in addition
  // to this command's own timestamped audit file above.
  recordAudit({
    command: `notion project ${options.mode}`,
    actor: process.env.USERNAME || process.env.USER || "unknown",
    slug: options.mode === "update" ? String(options.target) : "",
    diff: { requested_properties: properties, result: { page_id: result.id, url: result.url } },
    applied: true,
  });
  process.stdout.write(
    `${options.mode === "create" ? "Created" : "Updated"} ${result.url}\n` +
      `Audit: ${auditPath}\n`,
  );
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
