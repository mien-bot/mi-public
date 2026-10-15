const fs = require("node:fs");
const path = require("node:path");
const { load: loadYaml } = require("js-yaml");

const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function leadSlugFromCwd(value) {
  const match = /^leads\/([^/]+)\/?$/.exec(String(value || "").replace(/\\/g, "/"));
  return match && SAFE_SLUG.test(match[1]) ? match[1] : null;
}

function inside(root, target, allowRoot = false) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative) return allowRoot;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function relativeDropboxPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const candidate = value.trim();
  if (path.isAbsolute(candidate) || path.win32.isAbsolute(candidate) || path.posix.isAbsolute(candidate)) {
    throw new Error("The confirmed lead dropbox_path must remain relative.");
  }
  const segments = candidate.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || /[\0-\x1f]/.test(segment))) {
    throw new Error("The confirmed lead dropbox_path contains an unsafe segment.");
  }
  return segments;
}

function existingContainedDirectory(root, segments, label) {
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`${label} root is not reachable.`);
  }
  const realRoot = fs.realpathSync(root);
  const candidate = path.resolve(realRoot, ...segments);
  if (!inside(realRoot, candidate) || !fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`${label} is not reachable.`);
  }
  const resolved = fs.realpathSync(candidate);
  if (!inside(realRoot, resolved)) throw new Error(`${label} escapes its confirmed root.`);
  return resolved;
}

function resolveLeadRecordRoot({ runtimeDataRoot, settings }) {
  if (
    settings.dropboxFirmDataMigrated
    && settings.dropboxRoot
    && settings.dropboxFirmDataPath
  ) {
    const segments = relativeDropboxPath(settings.dropboxFirmDataPath);
    const shared = existingContainedDirectory(
      settings.dropboxRoot,
      segments,
      "Confirmed shared Mi data folder",
    );
    return path.join(shared, "leads");
  }
  return path.join(runtimeDataRoot, "leads");
}

/** Read identity without resolving the former lead folder: conversion may have moved it. */
function readLeadRecord({ runtimeDataRoot, settings, slug }) {
  if (!SAFE_SLUG.test(slug || "")) throw new Error("Invalid lead slug.");
  const recordsRoot = resolveLeadRecordRoot({ runtimeDataRoot, settings });
  const recordDirectory = existingContainedDirectory(recordsRoot, [slug], "Lead workspace");
  const metadataFile = path.join(recordDirectory, "lead.yaml");
  if (!fs.existsSync(metadataFile) || !fs.statSync(metadataFile).isFile()) {
    throw new Error("Lead workspace has no lead.yaml record.");
  }
  const lead = loadYaml(fs.readFileSync(metadataFile, "utf8"));
  return { lead, recordDirectory };
}

/** Resolve the lead's own folder for lead-specific harness and reference operations. */
function resolveLeadWorkspaceRoot(options) {
  const { settings } = options;
  const { lead, recordDirectory } = readLeadRecord(options);
  const dropboxSegments = relativeDropboxPath(lead?.dropbox_path);
  if (!dropboxSegments) return { lead, workspaceRoot: recordDirectory, dropboxPath: null };
  if (!settings.dropboxRoot) {
    throw new Error("Dropbox is not configured on this computer.");
  }
  const workspaceRoot = existingContainedDirectory(
    settings.dropboxRoot,
    dropboxSegments,
    "Confirmed lead Dropbox folder",
  );
  return { lead, workspaceRoot, dropboxPath: lead.dropbox_path };
}

/** Resolves <leadWorkspaceRoot>/Mi -- same containment/escape checks as agentHarness.js's
 * resolveHarnessRoot, but reusing resolveLeadWorkspaceRoot's Dropbox-optional resolution
 * instead of agentHarness's Dropbox-mandatory one, since a lead may have no confirmed Dropbox
 * folder yet and should still get a working, self-describing terminal. */
function resolveLeadHarnessRoot({ runtimeDataRoot, settings, slug }) {
  const { lead, workspaceRoot, dropboxPath } = resolveLeadWorkspaceRoot({ runtimeDataRoot, settings, slug });
  const harnessRoot = path.join(workspaceRoot, "Mi");
  if (fs.existsSync(harnessRoot)) {
    if (!fs.statSync(harnessRoot).isDirectory()) throw new Error("Lead agent workspace must be a directory.");
    const realHarnessRoot = fs.realpathSync(harnessRoot);
    if (!inside(workspaceRoot, realHarnessRoot)) throw new Error("Lead agent workspace escapes the confirmed lead folder.");
  }
  return { lead, workspaceRoot, harnessRoot, dropboxPath };
}

function resolveLeadTerminalWorkspace({ runtimeDataRoot, settings, slug }) {
  const { harnessRoot } = resolveLeadHarnessRoot({ runtimeDataRoot, settings, slug });
  if (!fs.existsSync(path.join(harnessRoot, "AGENTS.md")) || !fs.existsSync(path.join(harnessRoot, "CLAUDE.md"))) {
    throw new Error("Repair/Refresh Agent Workspace before launching an agent.");
  }
  return fs.realpathSync(harnessRoot);
}

module.exports = {
  readLeadRecord,
  leadSlugFromCwd,
  resolveLeadHarnessRoot,
  resolveLeadTerminalWorkspace,
  resolveLeadWorkspaceRoot,
};
