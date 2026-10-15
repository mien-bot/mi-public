// Relocates the single personal records.json (journal/thoughts/tasks/plans) to a new local
// folder. Simpler than electron/firmDataMigration.js's tree walk because there is exactly one
// file to move -- always local-only, never a Dropbox/shared destination.
const fs = require("node:fs");
const path = require("node:path");
const { hash, atomicWrite } = require("./agentHarness");

const RECORDS_FILENAME = "records.json";

function readHash(target) {
  return fs.existsSync(target) ? hash(fs.readFileSync(target)) : null;
}

/** "nothing-to-copy" when the source has no records.json yet (e.g. a fresh install). */
function previewPersonalDataMigration({ sourceDir, destDir }) {
  const sourceFile = path.join(sourceDir, RECORDS_FILENAME);
  if (!fs.existsSync(sourceFile)) {
    return { sourceDir, destDir, status: "nothing-to-copy", sourceHash: null, destHash: null };
  }
  const sourceHash = hash(fs.readFileSync(sourceFile));
  const destHash = readHash(path.join(destDir, RECORDS_FILENAME));
  const status = destHash === null ? "will-copy" : destHash === sourceHash ? "identical" : "needs-review";
  return { sourceDir, destDir, status, sourceHash, destHash };
}

/**
 * `confirmOverwrite` is required to proceed past "needs-review" (a different records.json
 * already exists at the destination) -- otherwise a second machine's or a stale destination's
 * data could silently disappear.
 */
function applyPersonalDataMigration(preview, { confirmOverwrite = false } = {}) {
  if (preview.status === "nothing-to-copy" || preview.status === "identical") {
    return { copied: false, status: preview.status };
  }
  if (preview.status === "needs-review" && !confirmOverwrite) {
    return {
      copied: false,
      status: "needs-review",
      error: "The destination already has different personal data. Confirm overwrite to continue.",
    };
  }
  const sourceFile = path.join(preview.sourceDir, RECORDS_FILENAME);
  const content = fs.readFileSync(sourceFile, "utf8");
  atomicWrite(path.join(preview.destDir, RECORDS_FILENAME), content, preview.destDir);
  return { copied: true, status: "copied" };
}

/** Leaves a breadcrumb at the old location; never deletes the source file. */
function markPersonalDataMigrated(sourceDir, destDir, migratedAtIso) {
  if (!fs.existsSync(path.join(sourceDir, RECORDS_FILENAME))) return;
  atomicWrite(
    path.join(sourceDir, "MOVED.md"),
    `# This local copy is a historical backup\n\nPersonal data moved to ${destDir} on ${migratedAtIso}. ` +
      "Mi no longer reads or writes here -- it's kept only as a point-in-time backup. Nothing here is deleted.\n",
    sourceDir,
  );
}

module.exports = { previewPersonalDataMigration, applyPersonalDataMigration, markPersonalDataMigrated };
