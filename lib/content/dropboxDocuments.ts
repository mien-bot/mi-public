import fs from "node:fs";
import path from "node:path";

export type DropboxDocumentKind = "contracts" | "owner-supplied" | "submissions" | "inspiration";

export interface DropboxDocumentCandidate {
  name: string;
  relativePath: string;
  modifiedAt: string;
  sizeBytes: number;
}

const MAX_DEPTH = 6;
const MAX_VISITED = 2_000;
const MAX_RESULTS = 200;

const KIND_PATTERNS: Record<DropboxDocumentKind, RegExp> = {
  contracts: /(contract|agreement|proposal|engagement|scope|fee|aia|owner.?architect)/i,
  "owner-supplied": /(owner.?supplied|existing.?condition|survey|deed|prior.?permit|owner.?document)/i,
  submissions: /(submission|submittal|permit|application|filing)/i,
  inspiration: /(inspiration|precedent|reference|mood.?board|concept.?image)/i,
};

const DOCUMENT_EXTENSION = /\.(pdf|docx?|xlsx?|pptx?|rtf|txt|csv|dwg|dxf|rvt|ifc|jpg|jpeg|png|webp|tiff?)$/i;

/**
 * Bounded, metadata-only discovery beneath an already-confirmed Dropbox root. Files inside a
 * matching category folder are included even when their filename is generic; elsewhere the
 * filename itself must match. No contents are opened and Dropbox is never modified.
 */
export function discoverDropboxDocuments(
  rootDir: string | null,
  kind: DropboxDocumentKind,
): DropboxDocumentCandidate[] {
  if (!rootDir || !fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return [];
  const results: DropboxDocumentCandidate[] = [];
  const pattern = KIND_PATTERNS[kind];
  let visited = 0;

  function walk(directory: string, relativeDirectory: string, depth: number, categoryFolder: boolean): void {
    if (depth > MAX_DEPTH || visited >= MAX_VISITED || results.length >= MAX_RESULTS) return;
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (visited >= MAX_VISITED || results.length >= MAX_RESULTS) return;
      visited += 1;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath, depth + 1, categoryFolder || pattern.test(entry.name));
      } else if (entry.isFile() && DOCUMENT_EXTENSION.test(entry.name) && (categoryFolder || pattern.test(entry.name))) {
        results.push({
          name: entry.name,
          relativePath,
          modifiedAt: stat.mtime.toISOString(),
          sizeBytes: stat.size,
        });
      }
    }
  }

  walk(rootDir, "", 0, false);
  return results.sort((left, right) => (
    right.modifiedAt.localeCompare(left.modifiedAt) || left.relativePath.localeCompare(right.relativePath)
  ));
}

/** Lists files already placed in a Mi document folder even when index.yaml has not been updated. */
export function discoverDocumentFolderFiles(folderDir: string): DropboxDocumentCandidate[] {
  if (!fs.existsSync(folderDir) || !fs.statSync(folderDir).isDirectory()) return [];
  const results: DropboxDocumentCandidate[] = [];
  let visited = 0;

  function walk(directory: string, relativeDirectory: string, depth: number): void {
    if (depth > MAX_DEPTH || visited >= MAX_VISITED || results.length >= MAX_RESULTS) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (visited >= MAX_VISITED || results.length >= MAX_RESULTS) return;
      visited += 1;
      if (entry.name.startsWith(".") || entry.name === "index.yaml" || entry.name === "archive") continue;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(absolutePath, relativePath, depth + 1);
      else if (entry.isFile() && DOCUMENT_EXTENSION.test(entry.name)) {
        results.push({
          name: entry.name,
          relativePath,
          modifiedAt: stat.mtime.toISOString(),
          sizeBytes: stat.size,
        });
      }
    }
  }

  walk(folderDir, "", 0);
  return results.sort((left, right) => (
    right.modifiedAt.localeCompare(left.modifiedAt) || left.relativePath.localeCompare(right.relativePath)
  ));
}
