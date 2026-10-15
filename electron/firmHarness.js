// Firm-wide (not per-project) chat workspace -- the packaged-mode delivery path for the
// holistic planning agent. Reuses electron/agentHarness.js's atomic-write/classify/
// containment helpers rather than reimplementing them (see resolveFirmHarnessRoot vs its
// per-project sibling resolveHarnessRoot).
const fs = require("node:fs");
const { brandPdfScript } = require("./pdfBrandingHelper");
const path = require("node:path");
const {
  HARNESS_VERSION,
  atomicWrite,
  classifyFile,
  existingDirectory,
  fetchUrlScript,
  formatScheduleLine,
  generated,
  hash,
  inside,
} = require("./agentHarness");

const SCHEDULE_ENTRY_LIMIT = 60;
const FIRM_MEMORY_FILES = new Map([
  ["memory/notes.md", "# Firm-wide planning memory\n\nUser-authored durable notes. Mi will preserve this file.\n"],
  ["memory/personal.md", "# Personal assistant memory\n\nUser-authored preferences and working conventions. Mi will preserve this file.\n"],
  ["memory/leads.md", "# Leads memory\n\nUser-authored lead follow-ups and relationship context. Mi will preserve this file.\n"],
  ["memory/permit-qaqc.md", "# Permit QA/QC memory\n\nUser-authored QA/QC conventions and durable review context. Mi will preserve this file.\n"],
]);

/**
 * Resolves <dropboxRoot>/<dropboxFirmDataPath>/Mi -- reuses the already-confirmed
 * dropboxFirmDataPath setting (shared clients/leads folder) rather than adding a new
 * folder picker. Same containment/escape checks as resolveHarnessRoot.
 */
function resolveFirmHarnessRoot(dropboxRoot, dropboxFirmDataPath) {
  if (!dropboxRoot) throw new Error("Select a local STUDIO Dropbox root first.");
  if (typeof dropboxFirmDataPath !== "string" || !dropboxFirmDataPath.trim()) {
    throw new Error("Confirm the shared Mi data folder in Settings before opening firm-wide chat.");
  }
  if (path.isAbsolute(dropboxFirmDataPath)) throw new Error("The shared Mi data folder path must remain relative.");
  const resolvedDropboxRoot = existingDirectory(path.resolve(dropboxRoot), "DROPBOX_ROOT");
  const firmCandidate = path.resolve(resolvedDropboxRoot, dropboxFirmDataPath);
  if (!inside(resolvedDropboxRoot, firmCandidate)) throw new Error("Shared Mi data folder escapes DROPBOX_ROOT.");
  const firmRoot = existingDirectory(firmCandidate, "Confirmed shared Mi data folder");
  if (!inside(resolvedDropboxRoot, firmRoot)) throw new Error("Shared Mi data folder escapes DROPBOX_ROOT.");
  const harnessRoot = path.join(firmRoot, "Mi");
  if (fs.existsSync(harnessRoot)) {
    const realHarnessRoot = existingDirectory(harnessRoot, "Firm-wide Mi workspace");
    if (!inside(firmRoot, realHarnessRoot)) throw new Error("Firm-wide Mi workspace escapes the confirmed shared data folder.");
  }
  return { firmRoot, harnessRoot };
}

/** Firm-wide (unfiltered by project) schedule text -- same source/style as agentHarness.js's buildScheduleContextMarkdown, minus the per-project split since there's no single project in scope here. */
function buildFirmScheduleMarkdown({ dataRoot, notionAttendeeName }) {
  if (!dataRoot) return null;
  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(path.join(dataRoot, "notion", "schedule-snapshot.json"), "utf8"));
  } catch {
    return null;
  }
  if (!snapshot || !Array.isArray(snapshot.entries) || snapshot.entries.length === 0) return null;

  const byDate = [...snapshot.entries].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const mine = notionAttendeeName
    ? byDate.filter((entry) =>
        (entry.attendees || []).some((a) => (a.name || "").trim().toLowerCase() === notionAttendeeName.trim().toLowerCase()))
    : [];

  const lines = [
    `# Firm-wide schedule context\n\nSTUDIO Schedule window: ${snapshot.window.from} to ${snapshot.window.to} ` +
      `(generated ${snapshot.generated_at}). Bounded and background-refreshed, not live.`,
    byDate.length
      ? byDate.slice(0, SCHEDULE_ENTRY_LIMIT).map(formatScheduleLine).join("\n")
      : "No items in this window.",
  ];
  if (byDate.length > SCHEDULE_ENTRY_LIMIT) {
    lines.push(`(${byDate.length - SCHEDULE_ENTRY_LIMIT} more item(s) in this window, not listed.)`);
  }
  lines.push(
    notionAttendeeName
      ? `Items where "${notionAttendeeName}" is listed in Attendance (${mine.length}): ` +
        (mine.length ? mine.map((entry) => `${entry.date} ${entry.name}`).join("; ") : "none in this window") + "."
      : "No confirmed attendee name is set in Settings — availability cannot be grounded to a specific person yet.",
  );
  return lines.join("\n\n");
}

function buildFirmDesiredFiles({ commonRules, portfolioBriefing, dataRoot, notionAttendeeName, synchronizedAt }) {
  const commonHash = hash(commonRules.trim());
  const scheduleMarkdown = buildFirmScheduleMarkdown({ dataRoot, notionAttendeeName });

  const files = new Map([
    // Forward slash, not path.join: previewFirmHarness uses these keys as the entry paths
    // verbatim and applyFirmHarness looks them up unchanged.
    ["tools/fetch-url.ps1", fetchUrlScript()],
    ["tools/brand-pdf.ps1", brandPdfScript()],
    ["AGENTS.md", generated(`# Mi firm-wide planning instructions for Codex\n\nCanonical rules SHA-256: \`${commonHash}\`\n\n${commonRules}`)],
    ["CLAUDE.md", generated(`# Mi firm-wide planning instructions for Claude\n\nCanonical rules SHA-256: \`${commonHash}\`\n\n${commonRules}`)],
    ["README.md", generated(`# Mi firm-wide planning workspace

This is a Dropbox-synchronized Mi workspace for firm-wide planning conversation, not scoped
to one project. Generated instructions and context are refreshed automatically in the
background. User-authored personal, leads, QA/QC, and firm memory under \`memory/\` is preserved.`)],
    [
      "manifest.json",
      `${JSON.stringify(
        { generatedBy: "Mi", harnessVersion: HARNESS_VERSION, canonicalRulesSha256: commonHash, synchronizedAt },
        null,
        2,
      )}\n`,
    ],
  ]);
  if (portfolioBriefing) files.set("PORTFOLIO_CONTEXT.md", generated(`# Portfolio briefing\n\n${portfolioBriefing}`));
  if (scheduleMarkdown) files.set("SCHEDULE_CONTEXT.md", generated(scheduleMarkdown));
  return files;
}

function previewFirmHarness(options) {
  const { harnessRoot } = resolveFirmHarnessRoot(options.dropboxRoot, options.dropboxFirmDataPath);
  const commonRules = fs.readFileSync(options.templatePath, "utf8");
  const synchronizedAt = options.synchronizedAt || new Date().toISOString();
  const desired = buildFirmDesiredFiles({ ...options, commonRules, synchronizedAt });
  const entries = [];
  for (const [relativePath, content] of desired) {
    const target = path.join(harnessRoot, relativePath);
    const classification = classifyFile(target, content);
    entries.push({
      relativePath,
      action: classification.action,
      existingHash: classification.existingHash,
      desiredHash: hash(content),
    });
  }
  for (const [relativePath, initialContent] of FIRM_MEMORY_FILES) {
    const memoryTarget = path.join(harnessRoot, relativePath);
    const memory = classifyFile(memoryTarget, "", { userAuthored: true });
    entries.push({
      relativePath,
      action: fs.existsSync(memoryTarget) ? "preserve" : "create",
      existingHash: memory.existingHash,
      desiredHash: fs.existsSync(memoryTarget) ? memory.existingHash : hash(initialContent),
    });
  }
  return { harnessRoot, desired, entries, synchronizedAt };
}

function applyFirmHarness(preview, { confirmed }) {
  if (confirmed !== true) throw new Error("Firm-wide workspace repair requires explicit confirmation.");
  const results = [];
  for (const entry of preview.entries) {
    const target = path.join(preview.harnessRoot, entry.relativePath);
    const currentHash = fs.existsSync(target) ? hash(fs.readFileSync(target)) : null;
    if (currentHash !== entry.existingHash) {
      results.push({ relativePath: entry.relativePath, status: "conflict", error: "File changed after preview." });
      continue;
    }
    if (entry.action === "preserve" || entry.action === "conflict") {
      results.push({ relativePath: entry.relativePath, status: entry.action });
      continue;
    }
    const content = FIRM_MEMORY_FILES.get(entry.relativePath) ?? preview.desired.get(entry.relativePath);
    if (typeof content !== "string") {
      results.push({ relativePath: entry.relativePath, status: "failed", error: "Missing generated content." });
      continue;
    }
    atomicWrite(target, content, preview.harnessRoot);
    results.push({ relativePath: entry.relativePath, status: entry.action === "create" ? "created" : "updated" });
  }
  return results;
}

module.exports = {
  applyFirmHarness,
  buildFirmDesiredFiles,
  buildFirmScheduleMarkdown,
  previewFirmHarness,
  resolveFirmHarnessRoot,
};
