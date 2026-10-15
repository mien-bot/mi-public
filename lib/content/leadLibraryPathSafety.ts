import fs from "node:fs";
import path from "node:path";

const WINDOWS_RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul", "clock$",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

const RESERVED_SLUGS = new Set(["new", "edit", "api", "index"]);
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function assertSafeWorkspaceSlug(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_SLUG.test(value)) {
    throw new Error(`${label} must use lowercase letters, numbers, and single hyphens only.`);
  }
  if (value.includes("--") || RESERVED_SLUGS.has(value) || WINDOWS_RESERVED_NAMES.has(value)) {
    throw new Error(`${label} "${value}" is reserved.`);
  }
  return value;
}

export function isPathInside(root: string, target: string, allowRoot = false): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative) return allowRoot;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertSafeSegment(segment: string, label: string): void {
  const deviceStem = segment.split(".")[0]?.toLowerCase();
  if (
    !segment || segment === "." || segment === ".." ||
    /[<>:"|?*\u0000-\u001f]/.test(segment) ||
    segment.endsWith(" ") || segment.endsWith(".") ||
    (deviceStem && WINDOWS_RESERVED_NAMES.has(deviceStem))
  ) {
    throw new Error(`${label} contains an unsafe path segment.`);
  }
}

export function normalizeSafeRelativePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  const candidate = value.trim();
  if (path.isAbsolute(candidate) || path.win32.isAbsolute(candidate) || path.posix.isAbsolute(candidate)) {
    throw new Error(`${label} must be relative.`);
  }
  const segments = candidate.replaceAll("\\", "/").split("/");
  for (const segment of segments) assertSafeSegment(segment, label);
  return segments.join("/");
}

export function assertNoSymlinkOrReparsePoint(root: string, relativePath: string): void {
  const segments = relativePath.split("/");
  let current = path.resolve(root);
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Path "${relativePath}" contains a symbolic link or reparse point.`);
    }
  }
}

export function resolveExistingFileWithin(
  root: string,
  relativePath: string,
  supportedExtensions: ReadonlySet<string>,
): string {
  const normalized = normalizeSafeRelativePath(relativePath, "Document path");
  const extension = path.extname(normalized).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error(`Unsupported document type "${extension || "(none)"}".`);
  }
  assertNoSymlinkOrReparsePoint(root, normalized);
  const target = path.resolve(root, ...normalized.split("/"));
  if (!isPathInside(root, target) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error("Document must be an existing file beneath the collection.");
  }
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  if (!isPathInside(realRoot, realTarget)) throw new Error("Document path escapes the collection.");
  return target;
}
