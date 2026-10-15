const fs = require("node:fs");
const path = require("node:path");
const { load: loadYaml } = require("js-yaml");

const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function permitQaqcSlugFromCwd(value) {
  const match = /^permit-qaqc\/([^/]+)\/?$/.exec(String(value || "").replace(/\\/g, "/"));
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
    throw new Error("The confirmed engagement's dropbox_path must remain relative.");
  }
  const segments = candidate.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || /[\0-\x1f]/.test(segment))) {
    throw new Error("The confirmed engagement's dropbox_path contains an unsafe segment.");
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

function resolvePermitQaqcRecordRoot({ runtimeDataRoot, settings }) {
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
    return path.join(shared, "permit-qaqc");
  }
  return path.join(runtimeDataRoot, "permit-qaqc");
}

/** Reads permit-qaqc/<slug>/qaqc.yaml plus its resolved record directory -- shared by the terminal cwd resolver and the agent workspace harness (electron/permitQaqcHarness.js). */
function resolvePermitQaqcEngagementRecord({ runtimeDataRoot, settings, slug }) {
  if (!SAFE_SLUG.test(slug || "")) throw new Error("Invalid permit-qaqc slug.");
  const recordsRoot = resolvePermitQaqcRecordRoot({ runtimeDataRoot, settings });
  const recordDirectory = existingContainedDirectory(recordsRoot, [slug], "Permit QAQC workspace");
  const metadataFile = path.join(recordDirectory, "qaqc.yaml");
  if (!fs.existsSync(metadataFile) || !fs.statSync(metadataFile).isFile()) {
    throw new Error("Permit QAQC workspace has no qaqc.yaml record.");
  }
  const engagement = loadYaml(fs.readFileSync(metadataFile, "utf8"));
  return { engagement, recordDirectory };
}

/** Resolves the engagement's real folder (the linked Dropbox folder when confirmed, otherwise
 * the structured engagement directory itself) plus <that folder>/Mi -- same containment/escape
 * checks as agentHarness.js's resolveHarnessRoot, but reusing this module's Dropbox-optional
 * resolution instead of agentHarness's Dropbox-mandatory one, since an engagement may have no
 * confirmed Dropbox folder yet and should still get a working, self-describing terminal. */
function resolvePermitQaqcHarnessRoot({ runtimeDataRoot, settings, slug }) {
  const { engagement, recordDirectory } = resolvePermitQaqcEngagementRecord({ runtimeDataRoot, settings, slug });
  const dropboxSegments = relativeDropboxPath(engagement?.dropbox_path);
  const workspaceRoot = dropboxSegments
    ? (() => {
        if (!settings.dropboxRoot) throw new Error("Dropbox is not configured on this computer.");
        return existingContainedDirectory(settings.dropboxRoot, dropboxSegments, "Confirmed engagement Dropbox folder");
      })()
    : recordDirectory;
  const harnessRoot = path.join(workspaceRoot, "Mi");
  if (fs.existsSync(harnessRoot)) {
    if (!fs.statSync(harnessRoot).isDirectory()) throw new Error("Permit QAQC agent workspace must be a directory.");
    const realHarnessRoot = fs.realpathSync(harnessRoot);
    if (!inside(workspaceRoot, realHarnessRoot)) throw new Error("Permit QAQC agent workspace escapes the confirmed engagement folder.");
  }
  return { engagement, workspaceRoot, harnessRoot, dropboxPath: engagement?.dropbox_path || null };
}

function resolvePermitQaqcTerminalWorkspace({ runtimeDataRoot, settings, slug }) {
  const { harnessRoot } = resolvePermitQaqcHarnessRoot({ runtimeDataRoot, settings, slug });
  if (!fs.existsSync(path.join(harnessRoot, "AGENTS.md")) || !fs.existsSync(path.join(harnessRoot, "CLAUDE.md"))) {
    throw new Error("Repair/Refresh Agent Workspace before launching an agent.");
  }
  return fs.realpathSync(harnessRoot);
}

module.exports = {
  permitQaqcSlugFromCwd,
  resolvePermitQaqcEngagementRecord,
  resolvePermitQaqcHarnessRoot,
  resolvePermitQaqcTerminalWorkspace,
};
