const fs = require("node:fs");
const path = require("node:path");

function containedSharedDataRoot(dropboxRoot, relativePath) {
  const root = path.resolve(dropboxRoot);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (
    !relative
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error("Shared Mi data folder must be inside the configured Dropbox root.");
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error("The confirmed shared Mi data folder is unavailable. Check Dropbox sync and try again.");
  }
  return target;
}

function resolveRuntimeDataRoot({
  packaged,
  developmentRoot,
  localDataRoot,
  dropboxRoot,
  sharedRelativePath,
  sharedDataRootEnabled,
}) {
  if (!packaged) return path.resolve(developmentRoot);
  if (!sharedDataRootEnabled) return path.resolve(localDataRoot);
  if (!dropboxRoot || !sharedRelativePath) {
    throw new Error("Shared Mi data is enabled but its confirmed Dropbox location is incomplete.");
  }
  return containedSharedDataRoot(dropboxRoot, sharedRelativePath);
}

module.exports = { containedSharedDataRoot, resolveRuntimeDataRoot };
