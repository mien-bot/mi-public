import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

const REVIEWABLE_EXTENSIONS = new Set([
  ".pdf", ".dwg", ".dxf", ".rvt", ".ifc", ".doc", ".docx", ".xls", ".xlsx",
  ".csv", ".jpg", ".jpeg", ".png", ".tif", ".tiff",
]);
const DEFAULT_MAX_FILES = 500;
const SKIPPED_DIRECTORY_NAMES = new Set([
  ".mi-backups",
  "archive",
  "archives",
  "sheetsnotused",
  "superseded",
]);

export interface DropboxReviewFile {
  relativePath: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface DropboxReviewBrief {
  project: { slug: string; name: string; dropboxPath: string };
  scannedAt: string;
  files: DropboxReviewFile[];
  truncated: boolean;
  countsByExtension: Record<string, number>;
  reviewPasses: string[];
  limitations: string[];
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function loadConfirmedProject(repoRoot: string, projectSlug: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectSlug)) throw new Error("Invalid project slug.");
  const projectFile = path.join(repoRoot, "projects", projectSlug, "project.yaml");
  if (!fs.existsSync(projectFile)) throw new Error(`Project "${projectSlug}" was not found.`);
  const parsed = loadYaml(fs.readFileSync(projectFile, "utf8")) as {
    name?: unknown;
    dropbox_path?: unknown;
  } | null;
  const name = typeof parsed?.name === "string" && parsed.name.trim()
    ? parsed.name.trim()
    : projectSlug;
  const dropboxPath = typeof parsed?.dropbox_path === "string"
    ? parsed.dropbox_path.trim()
    : "";
  if (!dropboxPath) {
    throw new Error("A human-confirmed project dropbox_path is required. No folder was scanned.");
  }
  if (path.isAbsolute(dropboxPath)) throw new Error("dropbox_path must remain relative.");
  return { name, dropboxPath };
}

function scanReviewableFiles(root: string, maxFiles: number): {
  files: DropboxReviewFile[];
  truncated: boolean;
} {
  const files: DropboxReviewFile[] = [];
  let truncated = false;

  function walk(directory: string) {
    if (truncated) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "Mi") continue;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) continue;
        walk(target);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!REVIEWABLE_EXTENSIONS.has(extension)) continue;
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      const stat = fs.statSync(target);
      files.push({
        relativePath: path.relative(root, target).replaceAll(path.sep, "/"),
        extension,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }

  walk(root);
  files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.relativePath.localeCompare(b.relativePath));
  return { files, truncated };
}

export function buildDropboxReviewBrief({
  repoRoot,
  dropboxRoot,
  projectSlug,
  maxFiles = DEFAULT_MAX_FILES,
  now = new Date(),
}: {
  repoRoot: string;
  dropboxRoot: string | undefined;
  projectSlug: string;
  maxFiles?: number;
  now?: Date;
}): DropboxReviewBrief {
  if (!dropboxRoot || !fs.existsSync(dropboxRoot) || !fs.statSync(dropboxRoot).isDirectory()) {
    throw new Error("DROPBOX_ROOT must be an existing directory.");
  }
  if (!Number.isInteger(maxFiles) || maxFiles < 1) throw new Error("maxFiles must be a positive integer.");
  const project = loadConfirmedProject(repoRoot, projectSlug);
  const realDropboxRoot = fs.realpathSync(dropboxRoot);
  const candidate = path.resolve(realDropboxRoot, project.dropboxPath);
  if (!inside(realDropboxRoot, candidate)) throw new Error("Confirmed project path escapes DROPBOX_ROOT.");
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error("The confirmed Dropbox project folder is unavailable on this machine.");
  }
  const projectRoot = fs.realpathSync(candidate);
  if (!inside(realDropboxRoot, projectRoot)) throw new Error("Confirmed project path escapes DROPBOX_ROOT.");

  const { files, truncated } = scanReviewableFiles(projectRoot, maxFiles);
  const countsByExtension = Object.fromEntries(
    [...new Set(files.map((file) => file.extension))].sort().map((extension) => [
      extension,
      files.filter((file) => file.extension === extension).length,
    ]),
  );

  return {
    project: { slug: projectSlug, name: project.name, dropboxPath: project.dropboxPath },
    scannedAt: now.toISOString(),
    files,
    truncated,
    countsByExtension,
    reviewPasses: [
      "Set identity: confirm issue date, revision, sheet index, and superseded sheets.",
      "Code and life safety: occupancy, construction type, egress, fire ratings, and accessibility.",
      "Architectural coordination: plans, elevations, sections, dimensions, details, and schedules.",
      "Structural coordination: loads, framing continuity, connections, foundations, and existing conditions.",
      "MEP coordination: equipment, shafts, penetrations, clearances, drainage, and drawing cross-references.",
      "Constructability: sequencing, tolerances, water management, temporary support, and field verification.",
      "Closeout: assign each comment a sheet, discipline, status, recommendation, and verification owner.",
    ],
    limitations: [
      "This inventory reads names and filesystem metadata only; it does not claim to have reviewed drawing contents.",
      "Folders explicitly named archive, archives, superseded, or SheetsNotUsed are excluded from the current-set inventory.",
      "PDF sheets, Bluebeam markups, and model files still require visual/technical review by a qualified person.",
      "Mi can draft comments and schedules, but external writes remain item-by-item confirmation gated.",
    ],
  };
}

export function renderDropboxReviewBrief(brief: DropboxReviewBrief): string {
  const fileLines = brief.files.length
    ? brief.files.map((file) =>
        `- ${file.relativePath} (${file.extension.slice(1).toUpperCase()}, ${file.modifiedAt.slice(0, 10)})`
      )
    : ["- No reviewable files were found."];
  return [
    `# QA/QC review brief: ${brief.project.name}`,
    "",
    `- Project slug: ${brief.project.slug}`,
    `- Confirmed Dropbox path: ${brief.project.dropboxPath}`,
    `- Scanned: ${brief.scannedAt}`,
    `- Reviewable files: ${brief.files.length}${brief.truncated ? " (inventory truncated)" : ""}`,
    "",
    "## Evidence inventory",
    "",
    ...fileLines,
    "",
    "## Required review passes",
    "",
    ...brief.reviewPasses.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Boundaries",
    "",
    ...brief.limitations.map((item) => `- ${item}`),
    "",
    "For Bluebeam: review the current PDF set visually, record page/sheet-specific comments,",
    "then export Revu's Markups List CSV and preview it with Mi's Bluebeam importer.",
  ].join("\n");
}
