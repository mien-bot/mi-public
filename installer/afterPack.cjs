/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this CommonJS hook */
const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

const FORBIDDEN_BASENAMES = new Set([".env.local", "project-map.json"]);
const FORBIDDEN_SEGMENTS = new Set([
  "clients",
  "leads",
  "projects",
  "codes",
  "reference",
  "library",
  ".mi",
  ".tmp",
]);
const SECRET_PATTERNS = [
  /NOTION_API_KEY\s*=\s*\S+/i,
  /\bsecret_[A-Za-z0-9_-]{20,}\b/,
  /C:\\+Users\\+Example User\\+/i,
];
const TEXT_FILE_PATTERN = /\.(?:js|json|md|ya?ml|txt|env)$/i;
const MAX_SCANNED_TEXT_BYTES = 2_000_000;

function normalizedRelative(value) {
  return value.replace(/^[/\\]+/, "").replaceAll("\\", "/");
}

function inspectEntry(relativePath, size, readContent, violations) {
  const relative = normalizedRelative(relativePath);
  const segments = relative.split("/");
  if (FORBIDDEN_BASENAMES.has(path.posix.basename(relative))) violations.push(relative);
  if (FORBIDDEN_SEGMENTS.has(segments[0])) violations.push(relative);
  if (size <= MAX_SCANNED_TEXT_BYTES && TEXT_FILE_PATTERN.test(relative)) {
    const text = readContent().toString("utf8");
    if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) violations.push(relative);
  }
}

function walk(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function scanDirectory(appRoot, violations) {
  for (const file of walk(appRoot)) {
    const relative = path.relative(appRoot, file);
    const stat = fs.statSync(file);
    inspectEntry(relative, stat.size, () => fs.readFileSync(file), violations);
  }
}

function scanArchive(archivePath, violations) {
  asar.uncache(archivePath);
  for (const archivedPath of asar.listPackage(archivePath, { isPack: false })) {
    const archiveLookupPath = archivedPath.replace(/^[/\\]+/, "");
    const relative = normalizedRelative(archivedPath);
    let stat;
    try {
      stat = asar.statFile(archivePath, archiveLookupPath, false);
    } catch {
      continue;
    }
    if ("files" in stat || "link" in stat) continue;
    inspectEntry(
      relative,
      stat.size,
      () => asar.extractFile(archivePath, archiveLookupPath, false),
      violations,
    );
  }
  asar.uncache(archivePath);
}

module.exports = async function scanPackagedApplication(context) {
  const resourcesRoot = path.join(context.appOutDir, "resources");
  const appRoot = path.join(resourcesRoot, "app");
  const archivePath = path.join(resourcesRoot, "app.asar");
  const runtimeRoot = path.join(resourcesRoot, "app-runtime");
  const violations = [];

  if (fs.existsSync(appRoot)) {
    scanDirectory(appRoot, violations);
  } else if (fs.existsSync(archivePath)) {
    scanArchive(archivePath, violations);
  } else {
    throw new Error("Packaged application payload was not found for security scanning.");
  }
  if (fs.existsSync(runtimeRoot)) scanDirectory(runtimeRoot, violations);

  if (violations.length) {
    throw new Error(
      `Forbidden content found in packaged output:\n${[...new Set(violations)].join("\n")}`,
    );
  }
};
