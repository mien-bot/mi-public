import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const safeContentRoot = path.join(repoRoot, ".tmp", "desktop-build-content");
const contentDirs = ["projects", "clients", "leads", "codes", "reference", "library", "notion"];

fs.rmSync(safeContentRoot, { recursive: true, force: true });
for (const dir of contentDirs) fs.mkdirSync(path.join(safeContentRoot, dir), { recursive: true });

const nextBin = path.join(repoRoot, "node_modules", "next", "dist", "bin", "next");
const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    MI_CONTENT_ROOT: safeContentRoot,
    DROPBOX_ROOT: "",
    MI_CODE_LIBRARY_ROOT: "",
    NOTION_API_KEY: "",
  },
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);

const standaloneRoot = path.join(repoRoot, ".next", "standalone");
if (!fs.existsSync(path.join(standaloneRoot, "server.js"))) {
  throw new Error("Next standalone server.js was not generated.");
}

fs.cpSync(path.join(repoRoot, ".next", "static"), path.join(standaloneRoot, ".next", "static"), {
  recursive: true,
});
const publicRoot = path.join(repoRoot, "public");
if (fs.existsSync(publicRoot)) {
  fs.cpSync(publicRoot, path.join(standaloneRoot, "public"), { recursive: true });
}

// Next emits the build checkout path into standalone runtime metadata. It is
// not needed at runtime and must not disclose a developer-specific location.
const encodedRepoRoot = JSON.stringify(repoRoot).slice(1, -1);
for (const relative of ["server.js", path.join(".next", "required-server-files.json")]) {
  const target = path.join(standaloneRoot, relative);
  if (!fs.existsSync(target)) continue;
  const sanitized = fs.readFileSync(target, "utf8")
    .replaceAll(encodedRepoRoot, ".")
    .replaceAll(repoRoot, ".");
  fs.writeFileSync(target, sanitized, "utf8");
}

// Turbopack can conservatively trace the repository root when an application
// route uses a dynamic local-file path. The installed server needs only the
// standalone runtime below; remove traced source/content after every build.
const runtimeEntries = new Set([".next", "node_modules", "package.json", "public", "server.js"]);
for (const entry of fs.readdirSync(standaloneRoot)) {
  if (!runtimeEntries.has(entry)) {
    fs.rmSync(path.join(standaloneRoot, entry), { recursive: true, force: true });
  }
}

console.log(`Prepared private-content-free desktop runtime at ${standaloneRoot}`);
