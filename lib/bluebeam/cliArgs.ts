/**
 * Parses `scripts/import-bluebeam-markups.ts`'s command-line flags into an
 * `ImportMapping` plus the preview/apply controls. Kept separate from the
 * script entry point so it's directly unit-testable without spawning a
 * subprocess.
 */
import type { ColumnOrValue, ImportMapping, MarkupStatus, StatusSource } from "./mapping";

export interface CliOptions {
  project?: string;
  csv?: string;
  apply: boolean;
  confirmProject?: string;
  help: boolean;
  mapping: ImportMapping;
}

const BOOLEAN_FLAGS = new Set(["--apply", "--help", "-h"]);

/** Splits "--flag=value" / "--flag value" pairs into a flat map; booleans need no value. */
function tokenize(argv: string[]): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--") && token !== "-h") continue;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      result.set(token.slice(0, eq), token.slice(eq + 1));
      continue;
    }
    if (BOOLEAN_FLAGS.has(token)) {
      result.set(token, true);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      result.set(token, next);
      i += 1;
    } else {
      result.set(token, true);
    }
  }
  return result;
}

function columnOrValue(flags: Map<string, string | true>, mapFlag: string, valueFlag: string): ColumnOrValue {
  const column = flags.get(mapFlag);
  const value = flags.get(valueFlag);
  return {
    ...(typeof column === "string" ? { column } : {}),
    ...(typeof value === "string" ? { value } : {}),
  };
}

/** Parses "Bluebeam Value = schema value, Another = other" into a raw record (validated later). */
export function parseStatusMapArg(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    if (pair.trim() === "") continue;
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key) map[key] = value;
  }
  return map;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const flags = tokenize(argv);
  const str = (flag: string): string | undefined => {
    const v = flags.get(flag);
    return typeof v === "string" ? v : undefined;
  };

  const statusColumn = str("--map-status");
  const statusValue = str("--status");
  const statusMapArg = str("--status-map");
  const status: StatusSource = {
    ...(statusColumn !== undefined ? { column: statusColumn } : {}),
    ...(statusValue !== undefined ? { value: statusValue as MarkupStatus } : {}),
    ...(statusMapArg !== undefined ? { statusMap: parseStatusMapArg(statusMapArg) as Record<string, MarkupStatus> } : {}),
  };

  const mapping: ImportMapping = {
    sheet: columnOrValue(flags, "--map-sheet", "--sheet"),
    revision: columnOrValue(flags, "--map-revision", "--revision"),
    date: columnOrValue(flags, "--map-date", "--date"),
    discipline: columnOrValue(flags, "--map-discipline", "--discipline"),
    file: columnOrValue(flags, "--map-file", "--file"),
    status,
    notes: columnOrValue(flags, "--map-notes", "--notes"),
    originalFile: columnOrValue(flags, "--map-original-file", "--original-file"),
    relatedCodeSections: columnOrValue(flags, "--map-related-code-sections", "--related-code-sections"),
  };

  return {
    project: str("--project"),
    csv: str("--csv"),
    apply: flags.get("--apply") === true,
    confirmProject: str("--confirm-project"),
    help: flags.get("--help") === true || flags.get("-h") === true,
    mapping,
  };
}
