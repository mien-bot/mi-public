const fs = require("node:fs");
const path = require("node:path");
const { load } = require("js-yaml");
const { readLeadRecord } = require("./leadRuntime");

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function projectRecord(runtimeDataRoot, slug) {
  if (typeof slug !== "string" || !SLUG.test(slug)) throw new Error("Invalid linked terminal project.");
  const root = fs.realpathSync(path.join(runtimeDataRoot, "projects"));
  const file = path.join(root, slug, "project.yaml");
  if (!fs.existsSync(file)) throw new Error("The linked terminal project is unavailable. Restore or correct its confirmed link.");
  const realFile = fs.realpathSync(file);
  const relative = path.relative(root, realFile);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Linked terminal project escapes the project records folder.");
  }
  const project = load(fs.readFileSync(realFile, "utf8"));
  if (!project || typeof project !== "object" || Array.isArray(project)) throw new Error("The linked terminal project record is invalid.");
  return project;
}

/** Read relationships on every launch. Never match names, discover folders, or rewrite records.
 * The result is also the renderer lock/session/pane identity, not just a replacement cwd. */
function resolveTerminalWorkspace({ workspace, runtimeDataRoot, settings }) {
  if (typeof workspace !== "string") throw new Error("Invalid terminal workspace.");
  const normalized = workspace.replaceAll("\\", "/");
  const match = /^(projects|leads)\/([^/]+)$/.exec(normalized);
  if (!match) return normalized;
  let slug = match[2];
  if (!SLUG.test(slug)) throw new Error("Invalid terminal workspace.");
  if (match[1] === "leads") {
    const { lead } = readLeadRecord({ runtimeDataRoot, settings, slug });
    if (lead.converted_project_slug == null) return normalized;
    slug = lead.converted_project_slug;
  }
  const visited = new Set();
  while (true) {
    if (visited.has(slug) || visited.size >= 32) throw new Error("Terminal project links contain a cycle or too many redirects. Correct the confirmed links.");
    visited.add(slug);
    const project = projectRecord(runtimeDataRoot, slug);
    if (project.terminal_project_slug == null) return `projects/${slug}`;
    slug = project.terminal_project_slug;
  }
}

module.exports = { resolveTerminalWorkspace };
