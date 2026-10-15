const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { load: loadYaml } = require("js-yaml");
const { applyHarnessPreview, previewHarness } = require("./agentHarness");

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function rendererSafeError(error, dropboxRoot) {
  let message = errorMessage(error);
  if (!dropboxRoot) return message;
  const variants = new Set([
    String(dropboxRoot),
    path.resolve(String(dropboxRoot)),
  ]);
  for (const root of variants) {
    message = message.replaceAll(root, "<DROPBOX_ROOT>");
    message = message.replaceAll(root.replaceAll("\\", "/"), "<DROPBOX_ROOT>");
    message = message.replaceAll(root.replaceAll("/", "\\"), "<DROPBOX_ROOT>");
  }
  return message;
}

function readLocalProjects(dataRoot) {
  const projectsRoot = path.join(dataRoot, "projects");
  if (!fs.existsSync(projectsRoot)) return [];
  return fs.readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const slug = entry.name;
      const projectSourceDir = path.join(projectsRoot, slug);
      try {
        const metadata = loadYaml(fs.readFileSync(path.join(projectSourceDir, "project.yaml"), "utf8")) || {};
        const dropboxPath = typeof metadata.dropbox_path === "string" && metadata.dropbox_path.trim()
          ? metadata.dropbox_path.trim()
          : null;
        return {
          slug,
          name: typeof metadata.name === "string" && metadata.name.trim() ? metadata.name.trim() : slug,
          dropboxPath,
          notionPageId: metadata.notion_page_id || null,
          skipProjectMirror: metadata.content_location === "dropbox",
          projectSourceDir,
        };
      } catch (error) {
        return {
          slug,
          name: slug,
          dropboxPath: null,
          projectSourceDir,
          error: `Project metadata could not be read: ${errorMessage(error)}`,
        };
      }
    });
}

function publicEntries(entries) {
  return entries.map(({ relativePath, action }) => ({ relativePath, action }));
}

function createAllProjectHarnessManager({
  idFactory = randomUUID,
  previewHarnessImpl = previewHarness,
  applyHarnessPreviewImpl = applyHarnessPreview,
  readProjects = readLocalProjects,
} = {}) {
  const batches = new Map();

  return {
    // dataRoot is the content root (where projects/<slug>/project.yaml lives) -- notionDataRoot
    // is deliberately a separate param: it's always configStore.dataRoot (the per-install
    // Electron userData root where the background Notion sync writes notion/schedule-
    // snapshot.json), which is NOT the same path as dataRoot once the shared Dropbox data
    // root feature is enabled. Never conflate the two.
    previewAll({ dataRoot, dropboxRoot, timezone, templatePath, notionDataRoot = null, notionAttendeeName = null }) {
      const batchId = idFactory();
      const projects = [];
      const skipped = [];
      const ready = [];

      for (const project of readProjects(dataRoot)) {
        if (project.error) {
          projects.push({
            name: project.name,
            slug: project.slug,
            dropboxPath: null,
            status: "error",
            error: project.error,
          });
          continue;
        }
        if (!project.dropboxPath) {
          skipped.push({
            name: project.name,
            slug: project.slug,
            reason: "No human-confirmed Dropbox folder is linked.",
          });
          continue;
        }

        try {
          const preview = previewHarnessImpl({
            dropboxRoot,
            dropboxPath: project.dropboxPath,
            timezone,
            templatePath,
            projectSourceDir: project.projectSourceDir,
            skipProjectMirror: project.skipProjectMirror,
            dataRoot: notionDataRoot,
            notionAttendeeName,
            project: {
              name: project.name,
              slug: project.slug,
              notionPageId: project.notionPageId,
            },
          });
          const previewId = idFactory();
          ready.push({ previewId, project, preview, dropboxRoot, dataRoot });
          projects.push({
            previewId,
            name: project.name,
            slug: project.slug,
            dropboxPath: project.dropboxPath,
            status: "ready",
            entries: publicEntries(preview.entries),
          });
        } catch (error) {
          projects.push({
            name: project.name,
            slug: project.slug,
            dropboxPath: project.dropboxPath,
            status: "error",
            error: rendererSafeError(error, dropboxRoot),
          });
        }
      }

      batches.set(batchId, ready);
      return { previewId: batchId, projects, skipped };
    },

    applyAll({ previewId, confirmed }) {
      if (confirmed !== true) {
        throw new Error("Ensuring all project workspaces requires explicit confirmation.");
      }
      const ready = batches.get(previewId);
      if (!ready) throw new Error("Preview expired or was already applied. Preview all workspaces again.");
      batches.delete(previewId);

      return {
        projects: ready.map(({ previewId: projectPreviewId, project, preview, dropboxRoot, dataRoot }) => {
          const base = {
            previewId: projectPreviewId,
            name: project.name,
            slug: project.slug,
            dropboxPath: project.dropboxPath,
          };
          try {
            const current = readProjects(dataRoot).find(candidate => candidate.slug === project.slug);
            if (!current || current.error || current.dropboxPath !== project.dropboxPath
              || current.skipProjectMirror !== project.skipProjectMirror) {
              throw new Error("The project's linked folder or data location changed. Check workspaces again before applying.");
            }
            const results = applyHarnessPreviewImpl(preview, { confirmed: true });
            return {
              ...base,
              status: results.some(entry => entry.status === "failed" || entry.status === "conflict") ? "partial" : "applied",
              results,
            };
          } catch (error) {
            return { ...base, status: "failed", error: rendererSafeError(error, dropboxRoot) };
          }
        }),
      };
    },

    clear() {
      batches.clear();
    },
  };
}

module.exports = {
  createAllProjectHarnessManager,
  readLocalProjects,
};
