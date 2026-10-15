const fs = require("node:fs");
const path = require("node:path");
const { containedSharedDataRoot } = require("./runtimeDataRoot");

/**
 * Read-only inspection of a candidate shared Mi data folder, so a second computer can answer
 * "why are there no projects?" before changing any setting. Choosing a Dropbox root and
 * choosing the shared data folder are separate steps (see electron/runtimeDataRoot.js): until
 * sharedDataRootEnabled flips, a packaged Mi keeps reading its own empty local dataRoot and the
 * UI honestly reports zero of everything. Counting both roots side by side is what makes that
 * visible instead of looking like a sync failure.
 *
 * This never writes, never creates the folder, and never mutates settings.
 */

/**
 * Each kind is counted by its own marker rather than by folder presence, so a half-synced
 * Dropbox folder (directories created, files still downloading) never reads as populated.
 * Clients are single YAML files; the rest are one directory per record.
 */
const RECORD_KINDS = [
  { key: "projects", label: "Projects", dir: "projects", marker: "project.yaml" },
  { key: "leads", label: "Leads", dir: "leads", marker: "lead.yaml" },
  { key: "clients", label: "Clients", dir: "clients", extension: ".yaml" },
  { key: "permitQaqc", label: "Permit QA/QC", dir: "permit-qaqc", marker: "qaqc.yaml" },
];

/** Null means the kind's folder is absent entirely -- different from a folder holding zero records. */
function countKind(dataRoot, kind) {
  const dir = path.join(dataRoot, kind.dir);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  if (kind.extension) {
    return entries.filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(kind.extension),
    ).length;
  }
  return entries.filter(
    (entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, kind.marker)),
  ).length;
}

function countDataRoot(dataRoot) {
  if (!dataRoot) return null;
  const counts = {};
  for (const kind of RECORD_KINDS) counts[kind.key] = countKind(dataRoot, kind);
  return counts;
}

/** Total across kinds, treating an absent folder as zero. */
function totalRecords(counts) {
  if (!counts) return 0;
  return RECORD_KINDS.reduce((sum, kind) => sum + (counts[kind.key] || 0), 0);
}

/**
 * Returns what each root actually holds plus which one this computer is reading right now.
 * Any unreachable/escaping shared path is reported as an error string rather than thrown, so
 * the settings screen can show it inline while the app keeps running.
 */
function inspectSharedData({
  dropboxRoot,
  sharedRelativePath,
  sharedDataRootEnabled,
  localDataRoot,
}) {
  const local = countDataRoot(localDataRoot);
  const report = {
    relativePath: sharedRelativePath || null,
    absolutePath: null,
    reachable: false,
    error: null,
    usingAsDataSource: sharedDataRootEnabled === true,
    shared: null,
    local,
    localTotal: totalRecords(local),
    sharedTotal: 0,
  };

  if (!dropboxRoot) {
    report.error = "Select this computer's local STUDIO Dropbox root first.";
    return report;
  }
  if (!sharedRelativePath || !String(sharedRelativePath).trim()) {
    report.error = "Choose the shared Mi data folder inside the Dropbox root first.";
    return report;
  }

  let target;
  try {
    target = containedSharedDataRoot(dropboxRoot, sharedRelativePath);
  } catch (error) {
    report.error = error.message;
    return report;
  }

  report.absolutePath = target;
  report.reachable = true;
  report.shared = countDataRoot(target);
  report.sharedTotal = totalRecords(report.shared);
  return report;
}

/**
 * Bounded scan for folders that already look like a Mi data root, so a second computer can be
 * offered its firm's folder instead of hunting for it in a directory picker. The convention is
 * a single top-level folder (`<Dropbox root>/7.00 Mi Data`), but the name is free-form and
 * differs per firm, so this matches on *contents* rather than on any name.
 *
 * Proposal only. The caller must have a human pick one -- same rule as dropbox_path and
 * notion_page_id, which Mi never infers on someone's behalf.
 */
const CANDIDATE_MAX_DEPTH = 2;
const CANDIDATE_SCAN_LIMIT = 400;

/** Dropbox roots hold large trees of drawings; skipping these keeps the scan bounded and quiet. */
const SKIPPED_DIRECTORIES = new Set([".dropbox.cache", "node_modules", ".git", ".mi-backups"]);

function findSharedDataCandidates(dropboxRoot) {
  if (!dropboxRoot) return [];
  const root = path.resolve(dropboxRoot);
  const found = [];
  let scanned = 0;

  function walk(dir, depth) {
    if (depth > CANDIDATE_MAX_DEPTH || scanned >= CANDIDATE_SCAN_LIMIT) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scanned >= CANDIDATE_SCAN_LIMIT) return;
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      scanned += 1;
      const child = path.join(dir, entry.name);
      const counts = countDataRoot(child);
      const total = totalRecords(counts);
      if (total > 0) {
        // A match is a leaf: the folders underneath it are records, not further candidates.
        found.push({
          relativePath: path.relative(root, child).split(path.sep).join("/"),
          counts,
          total,
        });
        continue;
      }
      walk(child, depth + 1);
    }
  }

  walk(root, 1);
  return found.sort((left, right) => right.total - left.total || left.relativePath.localeCompare(right.relativePath));
}

module.exports = {
  RECORD_KINDS,
  countDataRoot,
  totalRecords,
  inspectSharedData,
  findSharedDataCandidates,
};
