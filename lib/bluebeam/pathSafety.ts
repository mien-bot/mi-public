import path from "node:path";
import { resolveFileWithinDir } from "../content/fileServing";

export interface CsvSourceOk {
  ok: true;
  absolutePath: string;
  relativePath: string;
}
export interface CsvSourceError {
  ok: false;
  message: string;
}

/**
 * Restricts the CSV source path to `<project>/markups/**` using the same
 * containment rule `lib/content/fileServing.ts` already uses for served
 * project files: `path.join(baseDir, ...segments)` followed by a
 * `startsWith(baseDir + sep)` check, so `..` segments (or an absolute path
 * masquerading as a segment) can never resolve outside the base directory.
 * A CSV export must be placed inside the selected project's `markups/`
 * workspace before it can be imported — this deliberately does not accept
 * an arbitrary absolute path elsewhere on disk.
 */
export function resolveCsvSource(markupsDir: string, csvPathArg: string): CsvSourceOk | CsvSourceError {
  const segments = csvPathArg.split(/[\\/]+/).filter((segment) => segment.length > 0 && segment !== ".");
  const resolved = resolveFileWithinDir(markupsDir, segments);
  if (!resolved.ok) {
    return {
      ok: false,
      message: `"${csvPathArg}" is not a file inside this project's markups/ workspace (${markupsDir}): ${resolved.message}.`,
    };
  }
  return {
    ok: true,
    absolutePath: resolved.absolutePath,
    relativePath: path.relative(markupsDir, resolved.absolutePath),
  };
}
