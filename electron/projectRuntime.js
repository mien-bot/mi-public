const fs = require("node:fs");
const path = require("node:path");

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * The working directory an agent launches in.
 *
 * Mirrors resolveHarnessRoot in agentHarness.js: a Dropbox-linked project runs in
 * <dropbox>/<path>/Mi so the agent can reach the real project files; a project
 * with no confirmed dropbox_path runs in <localProjectRoot>/Mi instead. Keep the
 * two in step -- the harness generates the workspace this function then launches
 * into, so a disagreement about where it lives is a launch failure.
 */
function resolveInstalledProjectWorkspace({ dropboxRoot, dropboxPath, localProjectRoot, requireHarness = true }) {
  if (typeof dropboxPath !== "string" || !dropboxPath.trim()) {
    if (!localProjectRoot) {
      throw new Error("Confirm this project's Dropbox folder and repair its agent workspace first.");
    }
    if (!fs.existsSync(localProjectRoot) || !fs.statSync(localProjectRoot).isDirectory()) {
      throw new Error("This project's local folder is missing.");
    }
    const localRoot = fs.realpathSync(localProjectRoot);
    const localWorkspace = path.join(localRoot, "Mi");
    if (
      requireHarness &&
      (!fs.existsSync(path.join(localWorkspace, "AGENTS.md")) || !fs.existsSync(path.join(localWorkspace, "CLAUDE.md")))
    ) {
      throw new Error("Repair/Refresh Agent Workspace before launching an agent.");
    }
    const resolvedLocalWorkspace = fs.realpathSync(localWorkspace);
    if (!inside(localRoot, resolvedLocalWorkspace)) {
      throw new Error("Mi agent workspace escapes the project folder.");
    }
    return resolvedLocalWorkspace;
  }
  if (!dropboxRoot) {
    throw new Error("Confirm this project's Dropbox folder and repair its agent workspace first.");
  }
  if (path.isAbsolute(dropboxPath)) throw new Error("dropbox_path must remain relative.");
  if (!fs.existsSync(dropboxRoot) || !fs.statSync(dropboxRoot).isDirectory()) {
    throw new Error("DROPBOX_ROOT must be an existing directory.");
  }
  const resolvedDropboxRoot = fs.realpathSync(dropboxRoot);
  const projectCandidate = path.resolve(resolvedDropboxRoot, dropboxPath);
  if (!inside(resolvedDropboxRoot, projectCandidate)) {
    throw new Error("Project path escapes DROPBOX_ROOT.");
  }
  if (!fs.existsSync(projectCandidate) || !fs.statSync(projectCandidate).isDirectory()) {
    throw new Error("Confirmed project folder must be an existing directory.");
  }
  const projectRoot = fs.realpathSync(projectCandidate);
  if (!inside(resolvedDropboxRoot, projectRoot)) throw new Error("Project path escapes DROPBOX_ROOT.");
  const workspace = path.join(projectRoot, "Mi");
  if (
    requireHarness &&
    (!fs.existsSync(path.join(workspace, "AGENTS.md")) || !fs.existsSync(path.join(workspace, "CLAUDE.md")))
  ) {
    throw new Error("Repair/Refresh Agent Workspace before launching an agent.");
  }
  const resolvedWorkspace = fs.realpathSync(workspace);
  if (!inside(projectRoot, resolvedWorkspace)) {
    throw new Error("Mi agent workspace escapes the confirmed project folder.");
  }
  return resolvedWorkspace;
}

module.exports = { resolveInstalledProjectWorkspace };
