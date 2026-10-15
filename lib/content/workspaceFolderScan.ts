import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomically } from "./atomicContentWrite";
import { isConflictedCopyName } from "./dropboxConflicts";
import { resolveWorkspace, type WorkspaceKind } from "./workspaceOutbox";

const MAX_FILES = 5_000;
const MAX_DEPTH = 8;

/** Never scanned: Mi's own workspace, its backups, and Dropbox/OS bookkeeping. */
const SKIP_DIRECTORIES = new Set(["Mi", ".mi-backups", ".mi", ".git", "node_modules"]);
const SKIP_FILES = new Set(["desktop.ini", ".ds_store", "thumbs.db"]);

/**
 * Folders that usually hold the kind of document a meeting is about.
 *
 * A ranking boost, never a filter. Only three of the firm's fourteen project folders use
 * this scheme -- SampleCafe, SampleStudio and SampleRetail-1102-HVAC use 01_Drawings/02_Specifications,
 * HeyTea uses example-record-17, Rollins Rd uses "04 Correspondence" with a space, and several have no
 * scheme at all. Requiring these paths would silently collect nothing for most projects,
 * which is the failure this feature exists to fix.
 */
const NOTABLE_FOLDER_HINTS: [hint: string, weight: number][] = [
  // Inbound client correspondence is the most specific signal there is: a document that
  // arrived on the meeting date is almost always the one worth attaching. It has to
  // outrank the catch-all admin folder, which on a busy day holds a dozen dated files
  // and would otherwise crowd the redline off the list on path sort alone.
  ["06_corr/00_incoming", 40],
  ["06_corr/01_outgoing", 35],
  ["06_corr", 30],
  ["correspondence", 30],
  ["received", 30],
  ["04_presentation", 25],
  ["submissions", 25],
  ["permits", 25],
  ["03_production", 20],
  ["05_plot", 20],
  ["07_specs", 20],
  ["01_admin", 15],
  ["example-record-17", 15],
];

function folderHintWeight(folder: string): number {
  const normalized = folder.toLowerCase();
  let best = 0;
  for (const [hint, weight] of NOTABLE_FOLDER_HINTS) {
    if (normalized === hint || normalized.startsWith(`${hint}/`)) best = Math.max(best, weight);
  }
  return best;
}

export interface ScannedFile {
  /** Workspace-relative, forward-slashed, so it is portable across machines. */
  relativePath: string;
  fileName: string;
  folder: string;
  extension: string;
  size: number;
  /**
   * The date encoded in a `26_MMDD_` prefix, as YYYY-MM-DD.
   *
   * Preferred over mtime because Dropbox preserves the original modified time on download:
   * a file that arrives on this machine today can carry a months-old mtime, so mtime
   * cannot order arrival and cannot date the document either.
   */
  namedDate: string | null;
  /**
   * Whether the date came from the file or from a dated parent folder.
   *
   * The convention is applied to folders as often as to files -- the client redline on
   * 1000 W Example is `06_Corr/00_Incoming/26_0812_Casey Contract Redline/
   * 1000_W_Example_STUDIO_Contract_Redline.pdf`, where only the folder carries the date.
   * Reading filenames alone would have missed the exact document this feature exists to find.
   */
  dateSource: "file" | "folder" | null;
  /** True when the file sits in a folder that usually holds meeting-relevant documents. */
  notableFolder: boolean;
}

export type FolderScan =
  | { status: "unlinked" }
  | { status: "unreachable"; reason: string }
  | { status: "scanned"; root: string; files: ScannedFile[]; truncated: boolean };

const FILENAME_DATE = /^(\d{2})_(\d{2})(\d{2})_/;

/** `26_0812_Foo.pdf` -> `2026-08-12`. Rejects impossible calendar dates rather than guessing. */
export function namedDateFromFileName(fileName: string): string | null {
  const match = FILENAME_DATE.exec(fileName);
  if (!match) return null;
  const [, year, month, day] = match;
  const iso = `20${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Round-tripping catches 26_0230_ and 26_1332_, which Date would otherwise roll over.
  return parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * The date for a file, from its own name or the nearest dated ancestor folder.
 *
 * Deepest folder wins: `06_Corr/00_Incoming/26_0812_Casey Contract Redline/` dates its
 * contents more precisely than any folder above it would.
 */
export function namedDateForPath(relativePath: string): { date: string | null; source: "file" | "folder" | null } {
  const segments = relativePath.split("/");
  const fileName = segments[segments.length - 1] ?? "";
  const fromFile = namedDateFromFileName(fileName);
  if (fromFile) return { date: fromFile, source: "file" };
  for (let index = segments.length - 2; index >= 0; index -= 1) {
    const fromFolder = namedDateFromFileName(segments[index]);
    if (fromFolder) return { date: fromFolder, source: "folder" };
  }
  return { date: null, source: null };
}

function isNotableFolder(folder: string): boolean {
  return folderHintWeight(folder) > 0;
}

/**
 * Bounded, read-only walk of the confirmed workspace folder.
 *
 * Never throws for an unreachable folder: a Dropbox root that is offline, renamed, or not
 * yet synced has to be reported as "not read" rather than silently producing an empty
 * result that would read as "nothing new".
 */
export function scanWorkspaceFolder(kind: WorkspaceKind, slug: string): FolderScan {
  let root: string;
  try {
    const workspace = resolveWorkspace(kind, slug);
    if (!workspace.dropboxPath) return { status: "unlinked" };
    root = workspace.workspaceRoot;
  } catch (cause) {
    return { status: "unreachable", reason: cause instanceof Error ? cause.message : "The folder could not be resolved." };
  }
  return scanDirectory(root);
}

/** The walk itself, against any directory, so it can be exercised without a real record. */
export function scanDirectory(root: string): FolderScan {
  if (!fs.existsSync(root)) {
    return { status: "unreachable", reason: "The workspace folder is not available on this machine." };
  }
  const files: ScannedFile[] = [];
  let truncated = false;

  function walk(directory: string, depth: number): void {
    if (truncated || depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return; // An unreadable subfolder is skipped, not fatal to the whole scan.
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_FILES.has(entry.name.toLowerCase()) || entry.name.startsWith(".")) continue;
      // A Dropbox conflicted copy is not a new document; Mi never picks a winner.
      if (isConflictedCopyName(entry.name)) continue;

      let size: number;
      try {
        size = fs.statSync(absolute).size;
      } catch {
        continue;
      }
      const relativePath = path.relative(root, absolute).split(path.sep).join("/");
      const folder = path.dirname(relativePath) === "." ? "" : path.dirname(relativePath);
      const named = namedDateForPath(relativePath);
      files.push({
        relativePath,
        fileName: entry.name,
        folder,
        extension: path.extname(entry.name).toLowerCase(),
        size,
        namedDate: named.date,
        dateSource: named.source,
        notableFolder: isNotableFolder(folder),
      });
    }
  }

  try {
    walk(root, 0);
  } catch (cause) {
    return { status: "unreachable", reason: cause instanceof Error ? cause.message : "The folder could not be read." };
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { status: "scanned", root, files, truncated };
}

const folderIndexSchema = z.object({
  version: z.literal(1),
  scanned_at: z.string().datetime(),
  files: z.record(z.string(), z.object({
    size: z.number().int().nonnegative(),
    first_seen: z.string().datetime(),
  })).default({}),
});
export type FolderIndex = z.infer<typeof folderIndexSchema>;

function indexPath(kind: WorkspaceKind, slug: string): string {
  return path.join(resolveWorkspace(kind, slug).recordDir, ".mi", "folder-index.json");
}

export function readFolderIndex(kind: WorkspaceKind, slug: string): FolderIndex | null {
  try {
    const filePath = indexPath(kind, slug);
    if (!fs.existsSync(filePath)) return null;
    return folderIndexSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

export interface FolderChanges {
  /** Files present now that the index has never seen on this machine. */
  added: ScannedFile[];
  /** Files whose size changed since the last scan -- a redline replaced in place, say. */
  changed: ScannedFile[];
  /** Indexed paths no longer present. Reported, never acted on. */
  removed: string[];
  lastScannedAt: string | null;
}

/**
 * What changed since the last recorded scan.
 *
 * "Added" always means new *to this machine*: with no Dropbox API there is no server-side
 * cursor, so a file a partner created weeks ago is genuinely new here the day it syncs. UI
 * copy has to say so rather than implying the document was authored now.
 */
export function diffFolderScan(scan: FolderScan, index: FolderIndex | null): FolderChanges {
  if (scan.status !== "scanned") {
    return { added: [], changed: [], removed: [], lastScannedAt: index?.scanned_at ?? null };
  }
  const known = index?.files ?? {};
  const seenNow = new Set(scan.files.map((file) => file.relativePath));
  return {
    added: scan.files.filter((file) => !(file.relativePath in known)),
    changed: scan.files.filter((file) => {
      const previous = known[file.relativePath];
      return previous !== undefined && previous.size !== file.size;
    }),
    removed: Object.keys(known).filter((relativePath) => !seenNow.has(relativePath)),
    lastScannedAt: index?.scanned_at ?? null,
  };
}

/**
 * Records what this machine has now seen.
 *
 * `first_seen` is preserved for files already known, so a file keeps the date it actually
 * arrived here rather than being restamped by every later scan.
 */
export function writeFolderIndex(
  kind: WorkspaceKind,
  slug: string,
  scan: FolderScan,
  now: () => Date = () => new Date(),
): FolderIndex | null {
  if (scan.status !== "scanned") return null;
  const previous = readFolderIndex(kind, slug);
  const scannedAt = now().toISOString();
  const files: FolderIndex["files"] = {};
  for (const file of scan.files) {
    files[file.relativePath] = {
      size: file.size,
      first_seen: previous?.files[file.relativePath]?.first_seen ?? scannedAt,
    };
  }
  const index = folderIndexSchema.parse({ version: 1, scanned_at: scannedAt, files });
  // Rebuilt from the folder on every scan; a previous copy has no recovery value.
  writeFileAtomically(indexPath(kind, slug), `${JSON.stringify(index, null, 2)}\n`, { backup: false });
  return index;
}

export interface AttachmentCandidate {
  file: ScannedFile;
  score: number;
  reason: string;
}

/**
 * Ranks files as candidates to attach to a meeting on `meetingDate`.
 *
 * Scores the filename date first because it is the only trustworthy date signal, then the
 * folder hint, then extension readability. Everything scanned stays eligible -- a low score
 * sorts last rather than disappearing, so an unconventional folder layout degrades to a
 * longer list rather than an empty one.
 */
export function rankAttachmentCandidates(
  files: ScannedFile[],
  meetingDate: string,
  options: { limit?: number } = {},
): AttachmentCandidate[] {
  const readable = new Set([".pdf", ".docx", ".txt", ".md", ".eml", ".vtt"]);
  return files
    .map((file) => {
      const reasons: string[] = [];
      let score = 0;
      if (file.namedDate === meetingDate) {
        score += 100;
        reasons.push(file.dateSource === "folder" ? `in a folder dated ${file.namedDate}` : `named ${file.namedDate}`);
      } else if (file.namedDate) {
        const days = Math.abs(
          (Date.parse(`${file.namedDate}T00:00:00Z`) - Date.parse(`${meetingDate}T00:00:00Z`)) / 86_400_000,
        );
        if (days <= 7) {
          score += Math.round(60 - days * 6);
          reasons.push(`named ${file.namedDate}, within a week`);
        }
      }
      const folderWeight = folderHintWeight(file.folder);
      if (folderWeight > 0) {
        score += folderWeight;
        reasons.push(`in ${file.folder}`);
      }
      if (readable.has(file.extension)) score += 5;
      return { file, score, reason: reasons.join("; ") || "same folder" };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.file.relativePath.localeCompare(right.file.relativePath))
    .slice(0, options.limit ?? 20);
}
