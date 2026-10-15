import path from "node:path";

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function normalizeDropboxSelection(root: string, selectedAbsolutePath: string): string {
  if (!root) throw new Error("DROPBOX_ROOT is not configured on this machine.");
  const resolvedRoot = path.resolve(root);
  const resolvedSelection = path.resolve(selectedAbsolutePath);
  if (!isInside(resolvedRoot, resolvedSelection)) {
    throw new Error("Selected folder must be inside DROPBOX_ROOT.");
  }
  return path.relative(resolvedRoot, resolvedSelection).split(path.sep).join("/");
}

export function normalizeDropboxRelativePath(root: string, relativePath: string): string {
  if (!root) throw new Error("DROPBOX_ROOT is not configured on this machine.");
  if (
    !relativePath.trim()
    || path.isAbsolute(relativePath)
    || path.posix.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
  ) {
    throw new Error("Enter a relative Dropbox folder path.");
  }
  const portableSegments = relativePath.replaceAll("\\", "/").split("/");
  return normalizeDropboxSelection(root, path.resolve(root, ...portableSegments));
}

export function resolveDropboxRelativePath(root: string, relativePath: string): string {
  const normalized = normalizeDropboxRelativePath(root, relativePath);
  return path.resolve(root, normalized);
}
