/**
 * Preview-first orchestration: read a CSV, map it against markupEntrySchema,
 * diff it against the target project's existing markups/index.yaml, and
 * (only on explicit, confirmed request) merge + validate + atomically write
 * the result. `buildPreview` never touches disk beyond reading the CSV and
 * the existing index; only `applyImport` writes.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dump as dumpYaml } from "js-yaml";
import { readYamlFileIfExists } from "../content/fsUtils";
import { renameDurably } from "../content/durableRename";
import { PROJECTS_DIR } from "../content/paths";
import { markupIndexSchema, type MarkupEntry } from "../schema";
import { CsvHeaderError, parseCsv } from "./csv";
import { deriveIdentity } from "./identity";
import { mapRows, validateMapping, type ImportMapping } from "./mapping";
import { resolveCsvSource } from "./pathSafety";
import { isResolved, type ResolvedMarkupRow, type UnresolvedMarkupRow } from "./types";

export interface ImportOptions {
  projectSlug: string;
  csvPathArg: string;
  mapping: ImportMapping;
  /** Overrides PROJECTS_DIR — tests only. Never point this at the real projects/ tree. */
  projectsDir?: string;
}

export interface UpdateProposal {
  identity: string;
  existingIndex: number;
  existing: MarkupEntry;
  incoming: ResolvedMarkupRow;
}

export interface PreviewResult {
  projectSlug: string;
  projectDir: string;
  csvAbsolutePath: string;
  csvRelativePath: string;
  targetIndexPath: string;
  totalDataRows: number;
  additions: ResolvedMarkupRow[];
  updates: UpdateProposal[];
  duplicates: ResolvedMarkupRow[];
  unresolved: UnresolvedMarkupRow[];
  /** Two or more CSV rows in this one import resolved to the same composite identity. */
  withinBatchConflicts: { identity: string; rows: ResolvedMarkupRow[] }[];
  existingEntryCount: number;
  /**
   * 1-based source line numbers of genuinely blank physical CSV lines that
   * were skipped (never parsed as a data row, never a columnCountMismatch,
   * never counted as unresolved). Reported for provenance only — a blank
   * physical line never blocks apply and never requires an override.
   */
  skippedBlankRowNumbers: number[];
}

/** A normalized identity shared by two or more entries already in markups/index.yaml. */
export interface AmbiguousExistingIdentity {
  identity: string;
  /** 0-based positions in the existing index array that share this identity. */
  positions: number[];
}

export type PreviewFailure =
  | { kind: "project-error"; message: string }
  | { kind: "path-error"; message: string }
  | { kind: "header-error"; message: string }
  | { kind: "mapping-error"; issues: string[] }
  | { kind: "existing-index-invalid"; message: string }
  | { kind: "ambiguous-existing-identity"; message: string; conflicts: AmbiguousExistingIdentity[]; issues: string[] };

export type PreviewOutcome = { ok: true; result: PreviewResult } | { ok: false; error: PreviewFailure };

function resolveProjectPaths(slug: string, projectsDir: string) {
  const dir = path.join(projectsDir, slug);
  return { dir, markupsDir: path.join(dir, "markups"), indexPath: path.join(dir, "markups", "index.yaml") };
}

/**
 * Reads and schema-validates the existing markups/index.yaml. Never throws:
 * a pre-existing file that fails validation is reported as a graceful
 * failure (nothing is read further, nothing is written) rather than an
 * uncaught exception or a silently-accepted invalid base state.
 */
function readExistingEntries(indexPath: string): { ok: true; entries: MarkupEntry[] } | { ok: false; message: string } {
  try {
    return { ok: true, entries: readYamlFileIfExists(indexPath, (data) => markupIndexSchema.parse(data), []) };
  } catch (err) {
    return {
      ok: false,
      message: `Existing "${indexPath}" failed markupIndexSchema validation and cannot be safely merged into: ${(err as Error).message}`,
    };
  }
}

/**
 * Finds identities shared by two or more entries already in the existing
 * index — a pre-existing data-quality problem this importer did not cause
 * but must not paper over. Whether the conflicting entries are identical
 * or different in content, the importer has no basis for choosing one over
 * the other, so both cases are reported, not resolved.
 */
function findAmbiguousExistingIdentities(entries: MarkupEntry[]): AmbiguousExistingIdentity[] {
  const positionsByIdentity = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    const identity = deriveIdentity(entry);
    const positions = positionsByIdentity.get(identity) ?? [];
    positions.push(index);
    positionsByIdentity.set(identity, positions);
  });

  const conflicts: AmbiguousExistingIdentity[] = [];
  for (const [identity, positions] of positionsByIdentity) {
    if (positions.length > 1) conflicts.push({ identity, positions });
  }
  return conflicts;
}

/** Order-insensitive content comparison used to tell a no-op "duplicate" apart from an "update". */
function canonicalize(entry: MarkupEntry): string {
  return JSON.stringify({
    sheet: entry.sheet,
    revision: entry.revision,
    date: entry.date,
    discipline: entry.discipline,
    file: entry.file,
    original_file: entry.original_file ?? null,
    status: entry.status,
    notes: entry.notes ?? null,
    related_code_sections: [...entry.related_code_sections].sort(),
  });
}

export function buildPreview(options: ImportOptions): PreviewOutcome {
  const projectsDir = options.projectsDir ?? PROJECTS_DIR;
  const { dir: projectDir, markupsDir, indexPath } = resolveProjectPaths(options.projectSlug, projectsDir);

  if (!fs.existsSync(path.join(projectDir, "project.yaml"))) {
    return {
      ok: false,
      error: {
        kind: "project-error",
        message: `Project "${options.projectSlug}" does not exist (no projects/${options.projectSlug}/project.yaml). The project slug must identify an existing project and is never inferred from the CSV filename.`,
      },
    };
  }

  const source = resolveCsvSource(markupsDir, options.csvPathArg);
  if (!source.ok) {
    return { ok: false, error: { kind: "path-error", message: source.message } };
  }

  let csvText: string;
  try {
    csvText = fs.readFileSync(source.absolutePath, "utf8");
  } catch (err) {
    return { ok: false, error: { kind: "path-error", message: `Could not read "${source.absolutePath}": ${(err as Error).message}` } };
  }

  let parsedCsv;
  try {
    parsedCsv = parseCsv(csvText);
  } catch (err) {
    if (err instanceof CsvHeaderError) {
      return { ok: false, error: { kind: "header-error", message: err.message } };
    }
    throw err;
  }

  const mappingIssues = validateMapping(options.mapping, parsedCsv.headers);
  if (mappingIssues.length > 0) {
    return { ok: false, error: { kind: "mapping-error", issues: mappingIssues } };
  }

  const mappedRows = mapRows(parsedCsv.rows, options.mapping);
  const existingRead = readExistingEntries(indexPath);
  if (!existingRead.ok) {
    return { ok: false, error: { kind: "existing-index-invalid", message: existingRead.message } };
  }
  const existingEntries = existingRead.entries;

  // Detect ambiguous pre-existing identity before classifying anything —
  // if the existing index already can't tell two entries apart, the
  // importer must not silently pick a winner by classifying an addition,
  // update, or duplicate against either of them.
  const ambiguousExisting = findAmbiguousExistingIdentities(existingEntries);
  if (ambiguousExisting.length > 0) {
    return {
      ok: false,
      error: {
        kind: "ambiguous-existing-identity",
        message: `"${indexPath}" already contains ${ambiguousExisting.length} identity conflict(s) — two or more existing entries normalize to the same sheet/revision/file identity. Repair the file by hand (merge or disambiguate the conflicting entries) before importing; nothing was classified or written.`,
        conflicts: ambiguousExisting,
        issues: ambiguousExisting.map(
          (c) => `identity "${c.identity}" appears at existing index position(s) ${c.positions.join(", ")}`,
        ),
      },
    };
  }

  const existingByIdentity = new Map<string, { index: number; entry: MarkupEntry }>();
  existingEntries.forEach((entry, index) => existingByIdentity.set(deriveIdentity(entry), { index, entry }));

  const resolvedRows = mappedRows.filter(isResolved);
  const unresolved = mappedRows.filter((row): row is UnresolvedMarkupRow => row.kind === "unresolved");

  const byIdentityInBatch = new Map<string, ResolvedMarkupRow[]>();
  for (const row of resolvedRows) {
    const list = byIdentityInBatch.get(row.identity) ?? [];
    list.push(row);
    byIdentityInBatch.set(row.identity, list);
  }

  const withinBatchConflicts: { identity: string; rows: ResolvedMarkupRow[] }[] = [];
  const additions: ResolvedMarkupRow[] = [];
  const updates: UpdateProposal[] = [];
  const duplicates: ResolvedMarkupRow[] = [];

  for (const [identity, rows] of byIdentityInBatch) {
    if (rows.length > 1) {
      withinBatchConflicts.push({ identity, rows: [...rows].sort((a, b) => a.rowNumber - b.rowNumber) });
      continue;
    }
    const row = rows[0];
    const existing = existingByIdentity.get(identity);
    if (!existing) {
      additions.push(row);
    } else if (canonicalize(existing.entry) === canonicalize(row.entry)) {
      duplicates.push(row);
    } else {
      updates.push({ identity, existingIndex: existing.index, existing: existing.entry, incoming: row });
    }
  }

  additions.sort((a, b) => a.rowNumber - b.rowNumber);
  updates.sort((a, b) => a.incoming.rowNumber - b.incoming.rowNumber);
  duplicates.sort((a, b) => a.rowNumber - b.rowNumber);
  unresolved.sort((a, b) => a.rowNumber - b.rowNumber);

  return {
    ok: true,
    result: {
      projectSlug: options.projectSlug,
      projectDir,
      csvAbsolutePath: source.absolutePath,
      csvRelativePath: source.relativePath,
      targetIndexPath: indexPath,
      totalDataRows: parsedCsv.rows.length,
      additions,
      updates,
      duplicates,
      unresolved,
      withinBatchConflicts,
      existingEntryCount: existingEntries.length,
      skippedBlankRowNumbers: parsedCsv.blankRowNumbers,
    },
  };
}

export interface ApplyOptions extends ImportOptions {
  /** Must exactly equal projectSlug — the second deliberate control alongside --apply. */
  confirmProjectSlug: string;
}

export type ApplyFailure =
  | PreviewFailure
  | { kind: "confirmation-mismatch"; message: string }
  | { kind: "blocked-by-unresolved"; message: string; preview: PreviewResult }
  | { kind: "schema-validation-failed"; message: string; issues: string[] }
  | { kind: "write-failed"; message: string };

export interface ApplyResult {
  preview: PreviewResult;
  writtenIndexPath: string;
  backupPath: string;
  finalEntryCount: number;
  addedCount: number;
  updatedCount: number;
}

export type ApplyOutcome = { ok: true; result: ApplyResult } | { ok: false; error: ApplyFailure };

export function applyImport(options: ApplyOptions): ApplyOutcome {
  if (options.confirmProjectSlug !== options.projectSlug) {
    return {
      ok: false,
      error: {
        kind: "confirmation-mismatch",
        message: `--confirm-project "${options.confirmProjectSlug}" does not match the target project "${options.projectSlug}" — refusing to apply.`,
      },
    };
  }

  const previewOutcome = buildPreview(options);
  if (!previewOutcome.ok) return { ok: false, error: previewOutcome.error };
  const preview = previewOutcome.result;

  const hasBlockingRows = preview.unresolved.length > 0 || preview.withinBatchConflicts.length > 0;
  if (hasBlockingRows) {
    return {
      ok: false,
      error: {
        kind: "blocked-by-unresolved",
        message: `${preview.unresolved.length} unresolved row(s) and ${preview.withinBatchConflicts.length} within-batch identity conflict(s) exist. Fix the source CSV or field mapping and re-run — apply always requires zero unresolved rows and zero within-batch identity conflicts. Partial application is not supported; there is no override.`,
        preview,
      },
    };
  }

  const projectsDir = options.projectsDir ?? PROJECTS_DIR;
  const { indexPath } = resolveProjectPaths(options.projectSlug, projectsDir);

  const existingRead = readExistingEntries(indexPath);
  if (!existingRead.ok) {
    return { ok: false, error: { kind: "existing-index-invalid", message: existingRead.message } };
  }
  const merged = [...existingRead.entries];
  for (const update of preview.updates) {
    merged[update.existingIndex] = update.incoming.entry;
  }
  for (const addition of preview.additions) {
    merged.push(addition.entry);
  }

  const validated = markupIndexSchema.safeParse(merged);
  if (!validated.success) {
    return {
      ok: false,
      error: {
        kind: "schema-validation-failed",
        message: "Merged markup index failed markupIndexSchema validation — nothing was written; the original file is untouched.",
        issues: validated.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      },
    };
  }

  const backupDir = path.join(path.dirname(indexPath), ".bluebeam-import-backups");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `index.yaml.${timestamp}.bak`);

  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const originalContent = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : dumpYaml([], { lineWidth: 100 });
    fs.writeFileSync(backupPath, originalContent, "utf8");
  } catch (err) {
    return {
      ok: false,
      error: { kind: "write-failed", message: `Could not write recovery backup at "${backupPath}": ${(err as Error).message}. Original file left untouched.` },
    };
  }

  const tmpPath = path.join(path.dirname(indexPath), `.index.yaml.tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    fs.writeFileSync(tmpPath, dumpYaml(validated.data, { lineWidth: 100 }), "utf8");
    renameDurably(tmpPath, indexPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup only; the original file was never touched either way
    }
    return {
      ok: false,
      error: {
        kind: "write-failed",
        message: `Could not write "${indexPath}": ${(err as Error).message}. Original file left untouched; a recoverable backup is at "${backupPath}".`,
      },
    };
  }

  return {
    ok: true,
    result: {
      preview,
      writtenIndexPath: indexPath,
      backupPath,
      finalEntryCount: validated.data.length,
      addedCount: preview.additions.length,
      updatedCount: preview.updates.length,
    },
  };
}
