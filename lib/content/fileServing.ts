import fs from "node:fs";
import path from "node:path";

export const DOCUMENT_CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".dwg": "application/acad",
};

export interface ResolvedFile {
  ok: true;
  absolutePath: string;
  contentType: string;
}
export interface ResolveError {
  ok: false;
  status: 400 | 404;
  message: string;
}

function isWithinDir(baseDir: string, candidatePath: string): boolean {
  const relative = path.relative(baseDir, candidatePath);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

/** Resolves a path safely within `baseDir`, guarding against traversal outside it. */
export function resolveFileWithinDir(baseDir: string, segments: string[]): ResolvedFile | ResolveError {
  const resolvedBaseDir = path.resolve(baseDir);
  const requestedPath = path.resolve(resolvedBaseDir, ...segments);

  if (!isWithinDir(resolvedBaseDir, requestedPath)) {
    return { ok: false, status: 400, message: "Invalid path" };
  }

  let realBaseDir: string;
  let realRequestedPath: string;
  try {
    realBaseDir = fs.realpathSync.native(resolvedBaseDir);
    realRequestedPath = fs.realpathSync.native(requestedPath);
  } catch {
    return { ok: false, status: 404, message: "Not found" };
  }

  if (!isWithinDir(realBaseDir, realRequestedPath)) {
    return { ok: false, status: 400, message: "Invalid path" };
  }

  try {
    if (!fs.statSync(realRequestedPath).isFile()) {
      return { ok: false, status: 404, message: "Not found" };
    }
  } catch {
    return { ok: false, status: 404, message: "Not found" };
  }

  const contentType = DOCUMENT_CONTENT_TYPES[path.extname(requestedPath).toLowerCase()] ?? "application/octet-stream";
  return { ok: true, absolutePath: requestedPath, contentType };
}
