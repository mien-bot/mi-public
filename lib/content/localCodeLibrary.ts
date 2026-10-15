import fs from "node:fs";
import path from "node:path";

export const LOCAL_CODE_LIBRARY_ENV = "MI_CODE_LIBRARY_ROOT";
export const LEGACY_CODE_LIBRARY_RELATIVE_PATH = path.join(
  "projects",
  "chicago",
  "references",
  "codes-to-follow",
);

const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const MAX_DEPTH = 12;
const MAX_DOCUMENTS = 1_000;

export interface LocalCodeLibraryFileNode {
  kind: "file";
  name: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
}

export interface LocalCodeLibraryDirectoryNode {
  kind: "directory";
  name: string;
  relativePath: string;
  children: LocalCodeLibraryNode[];
}

export type LocalCodeLibraryNode =
  | LocalCodeLibraryFileNode
  | LocalCodeLibraryDirectoryNode;

export type LocalCodeLibrarySource = "environment" | "legacy-copy";

export type LocalCodeLibraryIndex =
  | {
      available: true;
      source: LocalCodeLibrarySource;
      nodes: LocalCodeLibraryNode[];
      documentCount: number;
      totalBytes: number;
      truncated: boolean;
    }
  | {
      available: false;
      message: string;
    };

interface LocalCodeLibraryOptions {
  env?: Readonly<Record<string, string | undefined>>;
  repoRoot?: string;
}

interface LocalCodeLibraryRoot {
  absolutePath: string;
  source: LocalCodeLibrarySource;
  explicitlyConfigured: boolean;
}

export type LocalCodeLibraryFileResolution =
  | {
      ok: true;
      absolutePath: string;
      contentType: string;
      fileName: string;
    }
  | {
      ok: false;
      status: 400 | 404;
      message: string;
    };

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(/* turbopackIgnore: true */ candidate).isDirectory();
  } catch {
    return false;
  }
}

function getRootCandidate(options: LocalCodeLibraryOptions = {}): LocalCodeLibraryRoot | null {
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot ?? process.cwd();
  const configuredRoot = env[LOCAL_CODE_LIBRARY_ENV]?.trim();

  if (configuredRoot) {
    return {
      absolutePath: path.resolve(/* turbopackIgnore: true */ repoRoot, configuredRoot),
      source: "environment",
      explicitlyConfigured: true,
    };
  }

  const legacyRoot = path.join(
    /* turbopackIgnore: true */
    repoRoot,
    LEGACY_CODE_LIBRARY_RELATIVE_PATH,
  );
  if (isDirectory(legacyRoot)) {
    return {
      absolutePath: legacyRoot,
      source: "legacy-copy",
      explicitlyConfigured: false,
    };
  }

  return null;
}

function toRelativePath(relativeDir: string, name: string): string {
  return relativeDir ? `${relativeDir}/${name}` : name;
}

function sortNodes(nodes: LocalCodeLibraryNode[]): LocalCodeLibraryNode[] {
  return nodes.sort(
    (a, b) =>
      Number(b.kind === "directory") - Number(a.kind === "directory") ||
      a.name.localeCompare(b.name),
  );
}

export function getLocalCodeLibraryIndex(
  options: LocalCodeLibraryOptions = {},
): LocalCodeLibraryIndex {
  const root = getRootCandidate(options);
  if (!root) {
    return {
      available: false,
      message: "No ignored local copy or configured private source was found.",
    };
  }
  if (!isDirectory(root.absolutePath)) {
    return {
      available: false,
      message: root.explicitlyConfigured
        ? `${LOCAL_CODE_LIBRARY_ENV} is configured, but its directory cannot be read.`
        : "The ignored local copy cannot be read.",
    };
  }

  let documentCount = 0;
  let totalBytes = 0;
  let truncated = false;

  function walk(dir: string, relativeDir: string, depth: number): LocalCodeLibraryNode[] {
    if (depth > MAX_DEPTH || documentCount >= MAX_DOCUMENTS) {
      truncated = true;
      return [];
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const nodes: LocalCodeLibraryNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || documentCount >= MAX_DOCUMENTS) {
        if (documentCount >= MAX_DOCUMENTS) truncated = true;
        continue;
      }

      const relativePath = toRelativePath(relativeDir, entry.name);
      const absolutePath = path.join(/* turbopackIgnore: true */ dir, entry.name);
      if (entry.isDirectory()) {
        const children = walk(absolutePath, relativePath, depth + 1);
        if (children.length > 0) {
          nodes.push({ kind: "directory", name: entry.name, relativePath, children });
        }
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_DOCUMENT_TYPES[extension]) continue;

      try {
        const stat = fs.statSync(/* turbopackIgnore: true */ absolutePath);
        documentCount += 1;
        totalBytes += stat.size;
        nodes.push({
          kind: "file",
          name: entry.name,
          relativePath,
          extension,
          sizeBytes: stat.size,
        });
      } catch {
        // A file can disappear while Dropbox is syncing; omit it from this request's index.
      }
    }

    return sortNodes(nodes);
  }

  try {
    const nodes = walk(root.absolutePath, "", 0);
    return {
      available: true,
      source: root.source,
      nodes,
      documentCount,
      totalBytes,
      truncated,
    };
  } catch {
    return {
      available: false,
      message: "The private source library could not be indexed.",
    };
  }
}

function isContainedPath(baseDir: string, candidate: string): boolean {
  const relative = path.relative(baseDir, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export function resolveLocalCodeLibraryFile(
  segments: string[],
  options: LocalCodeLibraryOptions = {},
): LocalCodeLibraryFileResolution {
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        segment.includes("\0"),
    )
  ) {
    return { ok: false, status: 400, message: "Invalid document path." };
  }

  const root = getRootCandidate(options);
  if (!root || !isDirectory(root.absolutePath)) {
    return { ok: false, status: 404, message: "Local code library unavailable." };
  }

  const requestedPath = path.resolve(
    /* turbopackIgnore: true */
    root.absolutePath,
    ...segments,
  );
  if (!isContainedPath(root.absolutePath, requestedPath)) {
    return { ok: false, status: 400, message: "Invalid document path." };
  }

  const extension = path.extname(requestedPath).toLowerCase();
  const contentType = ALLOWED_DOCUMENT_TYPES[extension];
  if (!contentType) {
    return { ok: false, status: 404, message: "Document type unavailable." };
  }

  try {
    if (!fs.statSync(/* turbopackIgnore: true */ requestedPath).isFile()) {
      return { ok: false, status: 404, message: "Document not found." };
    }

    const realRoot = fs.realpathSync(/* turbopackIgnore: true */ root.absolutePath);
    const realRequestedPath = fs.realpathSync(/* turbopackIgnore: true */ requestedPath);
    if (!isContainedPath(realRoot, realRequestedPath)) {
      return { ok: false, status: 400, message: "Invalid document path." };
    }

    return {
      ok: true,
      absolutePath: realRequestedPath,
      contentType,
      fileName: path.basename(realRequestedPath),
    };
  } catch {
    return { ok: false, status: 404, message: "Document not found." };
  }
}
