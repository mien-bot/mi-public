import fs from "node:fs";
import path from "node:path";

/**
 * Matches Dropbox's own conflicted-copy naming conventions -- e.g.
 * "schedule (Partner's conflicted copy 2026-07-26).yaml" or the older
 * "file (case-conflict 2013-05-09).ext" -- anchored to the parenthetical suffix right
 * before the extension so it doesn't false-positive on an ordinary filename that happens
 * to contain those words elsewhere.
 */
const CONFLICT_SUFFIX_PATTERN = /\s\((?:[^)]*?conflicted copy[^)]*?|[^)]*?case-conflict[^)]*?)\)(?=\.[^.]+$|$)/i;

export function isConflictedCopyName(filename: string): boolean {
  return CONFLICT_SUFFIX_PATTERN.test(filename);
}

export interface ConflictedFile {
  path: string;
  name: string;
  /** Best-effort display only -- the suffix is stripped, never used to auto-resolve. */
  likelyOriginalName: string;
}

const MAX_DEPTH = 6;
const MAX_ENTRIES = 1000;

/** Bounded scan for conflicted-copy files, so a huge/misconfigured directory can't hang. */
export function scanForConflicts(dir: string): ConflictedFile[] {
  const results: ConflictedFile[] = [];
  if (!fs.existsSync(dir)) return results;
  let visited = 0;
  function walk(current: string, depth: number) {
    if (depth > MAX_DEPTH || visited >= MAX_ENTRIES) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (visited++ >= MAX_ENTRIES) return;
      if (entry.name === ".mi-backups" || entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, depth + 1);
      } else if (isConflictedCopyName(entry.name)) {
        results.push({
          path: absolute,
          name: entry.name,
          likelyOriginalName: entry.name.replace(CONFLICT_SUFFIX_PATTERN, ""),
        });
      }
    }
  }
  walk(dir, 0);
  return results;
}
