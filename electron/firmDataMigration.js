// Firm-wide (clients/leads) migration to a shared Dropbox folder. A CJS sibling of
// lib/content/contentMigration.ts (same shape) rather than a shared import, because this
// needs electron/configStore.js's settings store directly, which the Next.js server
// process doesn't have access to (same constraint as electron/agentHarness.js vs.
// lib/content/dropboxMirror.ts already having parallel implementations).
const fs = require("node:fs");
const path = require("node:path");
const { hash, atomicWrite } = require("./agentHarness");

const MIGRATABLE_EXTENSIONS = new Set([".yaml", ".yml"]);
const MAX_DEPTH = 8;
const MAX_ENTRIES = 2000;

function listMigratableFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  let visited = 0;
  function walk(current, depth) {
    if (depth > MAX_DEPTH || visited >= MAX_ENTRIES) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (visited++ >= MAX_ENTRIES) return;
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute, depth + 1);
      else if (MIGRATABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
    }
  }
  walk(dir, 0);
  return files;
}

function readHash(target) {
  return fs.existsSync(target) ? hash(fs.readFileSync(target)) : null;
}

function previewKind(sourceDir, destDir) {
  const entries = [];
  for (const source of listMigratableFiles(sourceDir)) {
    const relativePath = path.relative(sourceDir, source).split(path.sep).join("/");
    const sourceHash = hash(fs.readFileSync(source));
    const destHash = readHash(path.join(destDir, ...relativePath.split("/")));
    const status = destHash === null ? "will-copy" : destHash === sourceHash ? "identical" : "needs-review";
    entries.push({ relativePath, status, sourceHash, destHash });
  }
  return { sourceDir, destDir, entries };
}

/** Preview for both clients and leads together -- one confirmed action covers both. */
function previewFirmDataMigration({ clientsSourceDir, clientsDestDir, leadsSourceDir, leadsDestDir }) {
  return {
    clients: previewKind(clientsSourceDir, clientsDestDir),
    leads: previewKind(leadsSourceDir, leadsDestDir),
  };
}

function applyKind(preview, includeRelativePaths) {
  const included = new Set(includeRelativePaths || []);
  const results = [];
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
      atomicWrite(target, fs.readFileSync(source, "utf8"), preview.destDir);
      results.push({ relativePath: entry.relativePath, status: "copied" });
    } catch (error) {
      results.push({ relativePath: entry.relativePath, status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

function markSourceMigrated(sourceDir, migratedAtIso) {
  if (!fs.existsSync(sourceDir)) return;
  atomicWrite(
    path.join(sourceDir, "MIGRATED-TO-DROPBOX.md"),
    `# This local copy is a historical backup\n\nThis data migrated to a shared Dropbox location on ${migratedAtIso}. ` +
      "Mi no longer reads or writes here -- it's kept only as a point-in-time backup. Nothing here is deleted.\n",
    sourceDir,
  );
}

/**
 * Applies both clients and leads previews. Only reports overall success (caller then flips
 * dropboxFirmDataMigrated) when neither side has an unresolved needs-review/failed entry --
 * otherwise some records would silently disappear from the now-authoritative shared folder.
 */
function applyFirmDataMigration({ clientsPreview, leadsPreview, includeRelativePaths }) {
  const clients = applyKind(clientsPreview, includeRelativePaths);
  const leads = applyKind(leadsPreview, includeRelativePaths);
  const unresolved = [...clients, ...leads].some((result) => result.status === "failed" || (result.status === "skipped" && result.error));
  return { clients, leads, migrationComplete: !unresolved };
}

module.exports = { previewFirmDataMigration, applyFirmDataMigration, markSourceMigrated };
