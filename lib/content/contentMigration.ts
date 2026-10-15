import fs from "node:fs";
import path from "node:path";
import { hashContent, readCurrentHash, writeFileAtomically } from "./atomicContentWrite";

/** Same allowlist as the Dropbox mirror (lib/content/dropboxMirror.ts) -- never touches binaries. */
const MIGRATABLE_EXTENSIONS = new Set([".md", ".yaml", ".yml", ".json"]);
const MAX_DEPTH = 8;
const MAX_ENTRIES = 2000;
/**
 * Top-level-only exclusions: project.yaml is the per-machine scaffold (dropbox_path,
 * content_location, notion_page_id) and must never migrate -- only the content beneath a
 * project moves. The retention marker is this module's own output; excluding it means a
 * re-preview after migration never tries to copy it into the shared destination too.
 */
const EXCLUDED_TOP_LEVEL_NAMES = new Set(["project.yaml", "MIGRATED-TO-DROPBOX.md"]);

export type MigrationEntryStatus = "will-copy" | "identical" | "needs-review";

export interface MigrationPreviewEntry {
  relativePath: string;
  status: MigrationEntryStatus;
  sourceHash: string;
  destHash: string | null;
}

export interface MigrationPreview {
  sourceDir: string;
  destDir: string;
  entries: MigrationPreviewEntry[];
}

export interface MigrationResultEntry {
  relativePath: string;
  status: "copied" | "skipped" | "failed";
  error?: string;
}

function listMigratableFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  let visited = 0;
  function walk(current: string, depth: number) {
    if (depth > MAX_DEPTH || visited >= MAX_ENTRIES) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (visited++ >= MAX_ENTRIES) return;
      if (entry.name.startsWith(".")) continue; // skip .mi-backups and similar
      if (depth === 0 && EXCLUDED_TOP_LEVEL_NAMES.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute, depth + 1);
      else if (MIGRATABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
    }
  }
  walk(dir, 0);
  return files;
}

/**
 * Bounded, read-only comparison of every migratable file under sourceDir against destDir.
 * "needs-review" (dest exists with different content) is never auto-resolved by applyMigration
 * unless the caller explicitly includes that relative path -- matching agentHarness.js's
 * classifyFile create/preserve/conflict model.
 */
export function previewMigration(sourceDir: string, destDir: string): MigrationPreview {
  const entries: MigrationPreviewEntry[] = [];
  for (const source of listMigratableFiles(sourceDir)) {
    const relativePath = path.relative(sourceDir, source).split(path.sep).join("/");
    const sourceHash = hashContent(fs.readFileSync(source));
    const destHash = readCurrentHash(path.join(destDir, ...relativePath.split("/")));
    const status: MigrationEntryStatus = destHash === null
      ? "will-copy"
      : destHash === sourceHash
        ? "identical"
        : "needs-review";
    entries.push({ relativePath, status, sourceHash, destHash });
  }
  return { sourceDir, destDir, entries };
}

/**
 * Copies (never moves) will-copy entries, skips identical entries (already safe), and skips
 * needs-review entries unless explicitly included in `includeRelativePaths` -- never a blanket
 * force-overwrite. The source directory is never modified or deleted; re-running preview after
 * a partial/interrupted migration naturally shows only the remaining files as will-copy.
 */
export function applyMigration(
  preview: MigrationPreview,
  options: { confirmed: boolean; includeRelativePaths?: string[] },
): MigrationResultEntry[] {
  if (options.confirmed !== true) throw new Error("Migration requires explicit confirmation.");
  const included = new Set(options.includeRelativePaths ?? []);
  const results: MigrationResultEntry[] = [];
  for (const entry of preview.entries) {
    if (entry.status === "identical") {
      results.push({ relativePath: entry.relativePath, status: "skipped" });
      continue;
    }
    if (entry.status === "needs-review" && !included.has(entry.relativePath)) {
      results.push({ relativePath: entry.relativePath, status: "skipped", error: "Destination differs; not included in this migration." });
      continue;
    }
    try {
      const source = path.join(preview.sourceDir, ...entry.relativePath.split("/"));
      const target = path.join(preview.destDir, ...entry.relativePath.split("/"));
      writeFileAtomically(target, fs.readFileSync(source, "utf8"));
      results.push({ relativePath: entry.relativePath, status: "copied" });
    } catch (cause) {
      results.push({
        relativePath: entry.relativePath,
        status: "failed",
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return results;
}

/** Marks the old local copy as a retained, no-longer-read historical backup. Never deletes it. */
export function markSourceMigrated(sourceDir: string, migratedAtIso: string): void {
  writeFileAtomically(
    path.join(sourceDir, "MIGRATED-TO-DROPBOX.md"),
    `# This local copy is a historical backup\n\nThis data migrated to a shared Dropbox location on ${migratedAtIso}. ` +
      "Mi no longer reads or writes here -- it's kept only as a point-in-time backup. Nothing here is deleted.\n",
  );
}
