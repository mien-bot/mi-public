/**
 * Shared "just drop a file, then index it" scan logic used by
 * index-library.ts (firm-wide library/<collection>/) and
 * index-project-folder.ts (per-project submissions/inspiration/contracts).
 * Adds a minimal entry for anything not already indexed; never deletes an
 * indexed entry whose file is gone, just warns about it.
 */
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { libraryIndexSchema, type LibraryDocument } from "../lib/schema";

const DOCUMENT_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".dwg", ".doc", ".docx"];

function humanizeFilename(filename: string): string {
  const base = filename.replace(path.extname(filename), "");
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function indexDocumentFolder(dir: string, label: string): void {
  const indexPath = path.join(dir, "index.yaml");

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created ${label}`);
  }

  const existing: LibraryDocument[] = fs.existsSync(indexPath)
    ? libraryIndexSchema.parse(loadYaml(fs.readFileSync(indexPath, "utf-8")) ?? [])
    : [];
  const existingFiles = new Set(existing.map((e) => e.file));

  const filesOnDisk = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => DOCUMENT_EXTENSIONS.includes(path.extname(name).toLowerCase()));

  const today = new Date().toISOString().slice(0, 10);
  const newEntries: LibraryDocument[] = filesOnDisk
    .filter((file) => !existingFiles.has(file))
    .map((file) => ({ file, title: humanizeFilename(file), tags: [], added_date: today }));

  const missing = existing.filter((e) => !filesOnDisk.includes(e.file));
  const updated = [...existing, ...newEntries];

  if (newEntries.length > 0 || !fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, dumpYaml(updated, { lineWidth: 100 }), "utf-8");
  }

  console.log(`${label}: ${updated.length} total, ${newEntries.length} newly indexed.`);
  if (newEntries.length > 0) {
    console.log("New:");
    for (const e of newEntries) console.log(`  - ${e.file} -> "${e.title}" (edit title/tags in index.yaml)`);
  }
  if (missing.length > 0) {
    console.log(
      `${missing.length} indexed entr${missing.length > 1 ? "ies" : "y"} missing from disk (not removed automatically):`,
    );
    for (const e of missing) console.log(`  - ${e.file}`);
  }
}
