const path = require("node:path");

function normalizeDropboxSelection(root, selectedPath) {
  if (!root) throw new Error("DROPBOX_ROOT is not configured on this machine.");
  const resolvedRoot = path.resolve(root);
  const resolvedSelection = path.resolve(selectedPath);
  const relative = path.relative(resolvedRoot, resolvedSelection);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Selected folder must be inside DROPBOX_ROOT.");
  }
  // Same list as lib/content/dropboxPaths.ts.
  if (relative.toLowerCase() === "projects") {
    throw new Error("That folder holds all the projects. Choose this project's own folder inside it.");
  }
  return relative.split(path.sep).join("/");
}

module.exports = { normalizeDropboxSelection };
