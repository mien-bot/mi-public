import { slugifyProjectName, type NotionPage } from "./projectMap";

export type ProjectWriteMode = "create" | "update";

export interface ProjectWriteOptions {
  mode: ProjectWriteMode;
  target?: string;
  name?: string;
  status?: string;
  client?: string;
  location?: string;
  projectTypes?: string[];
  scope?: string[];
  expectedLastEditedTime?: string;
  apply: boolean;
  envFile: string;
  projectsDataSourceId?: string;
}

export interface WritablePropertySchema {
  type: string;
  options?: string[];
}

export type WritableProjectSchema = Record<string, WritablePropertySchema>;

export type NotionWriteProperties = Record<string, unknown>;

const STATUS_ALIASES: Record<string, string> = {
  "not-started": "Not Started",
  "not started": "Not Started",
  "in-progress": "In Progress",
  "in progress": "In Progress",
  complete: "Complete",
  completed: "Complete",
  abandoned: "Abandoned",
};

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function addListValue(values: string[], raw: string): void {
  for (const value of raw.split(",")) {
    const trimmed = value.trim();
    if (trimmed && !values.includes(trimmed)) values.push(trimmed);
  }
}

export function parseProjectWriteArgs(argv: string[]): ProjectWriteOptions {
  const [modeValue, targetOrFirstFlag, ...rest] = argv;
  if (modeValue !== "create" && modeValue !== "update") {
    throw new Error('Expected "create" or "update".');
  }

  let args: string[];
  let target: string | undefined;
  if (modeValue === "update") {
    if (!targetOrFirstFlag || targetOrFirstFlag.startsWith("-")) {
      throw new Error("Project update requires a page ID, exact name, or mapped slug.");
    }
    target = targetOrFirstFlag;
    args = rest;
  } else {
    args = targetOrFirstFlag === undefined ? [] : [targetOrFirstFlag, ...rest];
  }

  const options: ProjectWriteOptions = {
    mode: modeValue,
    target,
    apply: false,
    envFile: ".env.local",
  };
  const projectTypes: string[] = [];
  const scope: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--name") {
      options.name = requireValue(args, index, arg).trim();
      index++;
      continue;
    }
    if (arg === "--status") {
      options.status = requireValue(args, index, arg).trim();
      index++;
      continue;
    }
    if (arg === "--client") {
      options.client = requireValue(args, index, arg).trim();
      index++;
      continue;
    }
    if (arg === "--clear-client") {
      options.client = "";
      continue;
    }
    if (arg === "--location") {
      options.location = requireValue(args, index, arg).trim();
      index++;
      continue;
    }
    if (arg === "--clear-location") {
      options.location = "";
      continue;
    }
    if (arg === "--project-type") {
      addListValue(projectTypes, requireValue(args, index, arg));
      index++;
      continue;
    }
    if (arg === "--clear-project-types") {
      projectTypes.length = 0;
      options.projectTypes = [];
      continue;
    }
    if (arg === "--scope") {
      addListValue(scope, requireValue(args, index, arg));
      index++;
      continue;
    }
    if (arg === "--clear-scope") {
      scope.length = 0;
      options.scope = [];
      continue;
    }
    if (arg === "--expected-last-edited") {
      options.expectedLastEditedTime = requireValue(args, index, arg);
      index++;
      continue;
    }
    if (arg === "--env-file") {
      options.envFile = requireValue(args, index, arg);
      index++;
      continue;
    }
    if (arg === "--projects-source") {
      options.projectsDataSourceId = requireValue(args, index, arg);
      index++;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    throw new Error(`Unknown option "${arg}".`);
  }

  if (projectTypes.length > 0) options.projectTypes = projectTypes;
  if (scope.length > 0) options.scope = scope;
  if (options.mode === "create" && !options.name) {
    throw new Error("Project create requires --name.");
  }
  return options;
}

function canonicalOption(
  field: string,
  raw: string,
  schema: WritableProjectSchema,
): string {
  const options = schema[field]?.options ?? [];
  const requested =
    field === "Status"
      ? (STATUS_ALIASES[raw.toLocaleLowerCase()] ?? raw)
      : raw;
  const match = options.find(
    (option) => option.toLocaleLowerCase() === requested.toLocaleLowerCase(),
  );
  if (!match) {
    throw new Error(
      `${field} value "${raw}" is not configured in Notion. Allowed: ${options.join(", ")}`,
    );
  }
  return match;
}

function canonicalOptions(
  field: string,
  values: string[],
  schema: WritableProjectSchema,
): string[] {
  return values.map((value) => canonicalOption(field, value, schema));
}

export function buildProjectProperties(
  options: ProjectWriteOptions,
  schema: WritableProjectSchema,
): NotionWriteProperties {
  const properties: NotionWriteProperties = {};
  if (options.name !== undefined) {
    properties.Name = {
      title: options.name ? [{ text: { content: options.name } }] : [],
    };
  }
  if (options.status !== undefined) {
    properties.Status = {
      status: { name: canonicalOption("Status", options.status, schema) },
    };
  }
  if (options.client !== undefined) {
    properties.Client = {
      rich_text: options.client
        ? [{ text: { content: options.client } }]
        : [],
    };
  }
  if (options.location !== undefined) {
    properties.Location = {
      rich_text: options.location
        ? [{ text: { content: options.location } }]
        : [],
    };
  }
  if (options.projectTypes !== undefined) {
    properties["Project Type"] = {
      multi_select: canonicalOptions("Project Type", options.projectTypes, schema).map(
        (name) => ({ name }),
      ),
    };
  }
  if (options.scope !== undefined) {
    properties.Scope = {
      multi_select: canonicalOptions("Scope", options.scope, schema).map((name) => ({
        name,
      })),
    };
  }
  if (Object.keys(properties).length === 0) {
    throw new Error("No writable project fields were provided.");
  }
  return properties;
}

export function resolveProjectTarget(pages: NotionPage[], target: string): NotionPage {
  const normalizedId = target.replaceAll("-", "").toLocaleLowerCase();
  const matches = pages.filter((page) => {
    const nameProperty = page.properties.Name;
    const name =
      nameProperty?.type === "title"
        ? (nameProperty.title ?? []).map((part) => part.plain_text).join("").trim()
        : "";
    return (
      page.id.replaceAll("-", "").toLocaleLowerCase() === normalizedId ||
      name.toLocaleLowerCase() === target.toLocaleLowerCase() ||
      slugifyProjectName(name, page.id) === target
    );
  });
  if (matches.length === 0) {
    throw new Error(`No Notion project matched "${target}".`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple Notion projects matched "${target}". Use the page ID.`);
  }
  return matches[0];
}
