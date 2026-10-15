import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { renameDurably, retryWhileLocked } from "./durableRename";

/**
 * Thrown when `expectedHash` is given and the file's current on-disk content no longer
 * matches it -- someone else (another Mi instance, a Dropbox sync) changed it since it was
 * last read. The write is refused; nothing is touched.
 */
export class ContentConflictError extends Error {
  filePath: string;
  expectedHash: string | null;
  currentHash: string | null;

  constructor(filePath: string, expectedHash: string | null, currentHash: string | null) {
    super(`"${filePath}" changed since it was last read.`);
    this.name = "ContentConflictError";
    this.filePath = filePath;
    this.expectedHash = expectedHash;
    this.currentHash = currentHash;
  }
}

function uniqueSuffix(): string {
  return `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
}

export function hashContent(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** `null` when the file doesn't exist yet, matching agentHarness.js's `existingHash: null`. */
export function readCurrentHash(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return hashContent(fs.readFileSync(filePath));
}

export interface AtomicWriteOptions {
  /**
   * Re-checked immediately before writing; a mismatch throws ContentConflictError instead
   * of writing. Pass `null` to mean "expected not to exist yet". Omit entirely to skip the
   * check (today's single-machine behavior -- still gets atomic-write/backup safety).
   */
  expectedHash?: string | null;
  backupDirectory?: string;
  /**
   * Set false for derived bookkeeping Mi can regenerate at will.
   *
   * A backup exists so a person can recover authored content after a bad write. An
   * analysis snapshot or a folder seen-index has no such value -- it is rewritten on every
   * run by definition, so keeping copies only accumulates files, and these live in the
   * firm's shared Dropbox folder where that accumulation is everyone's problem.
   */
  backup?: boolean;
}

export interface AtomicWriteResult {
  filePath: string;
  backupPath: string | null;
}

/**
 * Same tmp+wx-flag+backup+rename shape as electron/agentHarness.js's atomicWrite and
 * lib/content/leadLibraryAtomicWrite.ts's writeYamlAtomically, generalized to take
 * already-serialized string content (YAML, Markdown, anything) instead of dumping YAML
 * itself, so one primitive covers project schedule/details/meeting-note writers.
 */
export function writeFileAtomically(
  filePath: string,
  content: string,
  options: AtomicWriteOptions = {},
): AtomicWriteResult {
  if (options.expectedHash !== undefined) {
    const currentHash = readCurrentHash(filePath);
    if (currentHash !== options.expectedHash) {
      throw new ContentConflictError(filePath, options.expectedHash, currentHash);
    }
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${uniqueSuffix()}.tmp`;
  let backupPath: string | null = null;

  try {
    fs.writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    if (options.backup !== false && fs.existsSync(filePath)) {
      const backupDirectory = options.backupDirectory ?? path.join(path.dirname(filePath), ".mi-backups");
      fs.mkdirSync(backupDirectory, { recursive: true });
      const backupTarget = path.join(backupDirectory, `${path.basename(filePath)}.${uniqueSuffix()}.bak`);
      retryWhileLocked(() => fs.copyFileSync(filePath, backupTarget, fs.constants.COPYFILE_EXCL));
      backupPath = backupTarget;
    }
    renameDurably(temporaryPath, filePath);
    return { filePath, backupPath };
  } catch (cause) {
    // Retain staged content on failure, including ENOSPC while recording recovery.
    // Removing it here defeated durableRename's promise to preserve a draft.
    throw cause;
  }
}
