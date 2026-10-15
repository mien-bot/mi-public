// Best-effort one-way mirror of repo-canonical project text knowledge into Dropbox.
// Kept in plain CommonJS because Electron's main process does not run through
// the Next.js/TypeScript pipeline (same constraint as electron/main.js).
const fs = require("node:fs");
const path = require("node:path");
const { load: loadYaml } = require("js-yaml");
const { atomicWrite } = require("./agentHarness");

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

const MIRRORED_EXTENSIONS = new Set([".md", ".yaml", ".yml", ".json"]);

function listKnowledgeFiles(projectDir) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (MIRRORED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(absolute);
      }
    }
  }
  walk(projectDir);
  return files;
}

function mirrorProjectKnowledge({ repoRoot, projectSlug, dropboxRoot, logger = console }) {
  if (!projectSlug || !dropboxRoot) return { mirrored: false, reason: "not-linked" };

  try {
    const projectDir = path.join(repoRoot, "projects", projectSlug);
    const projectFile = path.join(projectDir, "project.yaml");
    if (!fs.existsSync(projectFile)) {
      return { mirrored: false, reason: "missing-source" };
    }

    const project = loadYaml(fs.readFileSync(projectFile, "utf8"));
    const dropboxPath = typeof project?.dropbox_path === "string" ? project.dropbox_path.trim() : "";
    if (!dropboxPath) return { mirrored: false, reason: "not-linked" };
    // Once migrated, Mi/project/ is the live content root -- mirroring into itself is
    // unnecessary at best and a stale-overwrite risk at worst. Short-circuit instead.
    if (project?.content_location === "dropbox") return { mirrored: false, reason: "already-shared" };

    const projectDropboxDir = path.resolve(dropboxRoot, dropboxPath);
    if (!isInside(dropboxRoot, projectDropboxDir)) {
      throw new Error(`dropbox_path escapes DROPBOX_ROOT: ${dropboxPath}`);
    }

    const destination = path.join(projectDropboxDir, "Mi");
    fs.mkdirSync(destination, { recursive: true });

    const files = listKnowledgeFiles(projectDir);
    for (const source of files) {
      const relative = path.relative(projectDir, source);
      const target = path.join(destination, relative);
      atomicWrite(target, fs.readFileSync(source, "utf8"), destination);
    }

    // No second copy at Mi/notes.md. The walk above already mirrors memory/notes.md to
    // Mi/memory/notes.md, which is the path the live writer (lib/content/dropboxMirror.ts's
    // appendDropboxProjectMemoryNote) appends confirmed memory-note cards to. The extra root
    // copy was written once and then never updated by that writer, so a workspace ended up
    // with two notes.md files disagreeing about the project, and an agent reading the root one
    // got silently stale knowledge.

    atomicWrite(
      path.join(destination, "README.md"),
      `# Mi project knowledge\n\nOne-way mirror from \`projects/${projectSlug}/\`. ` +
        `Edit the repository copy; Dropbox is refreshed by Mi.\n`,
      destination,
    );
    logger.log(`Mirrored ${files.length} project knowledge file(s) to ${destination}`);
    return { mirrored: true, destination, fileCount: files.length };
  } catch (error) {
    logger.error(
      `Project memory mirror failed for ${projectSlug}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { mirrored: false, reason: "error" };
  }
}

const mirrorProjectMemory = mirrorProjectKnowledge;

module.exports = { isInside, mirrorProjectKnowledge, mirrorProjectMemory };
