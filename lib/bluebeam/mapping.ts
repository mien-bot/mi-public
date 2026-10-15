/**
 * Maps parsed CSV rows onto `markupEntrySchema`. Every field is either a
 * fixed CLI-supplied value (applied to every row — useful when a whole
 * Markups List export corresponds to one sheet/file/discipline) or a named
 * CSV column (read per row). There is no automatic column-name guessing and
 * no inference from filenames or sheet-number prefixes: a field that has
 * neither an explicit `--map-<field>` column nor an explicit fixed value is
 * always unresolved, never guessed.
 */
import type { z } from "zod";
import { disciplineSchema, markupEntrySchema, markupStatusSchema, type MarkupEntry } from "../schema";
import type { CsvRow } from "./csv";
import { deriveIdentity } from "./identity";
import type { MappedRow } from "./types";

// lib/schema.ts exports markupStatusSchema but not its inferred type — derive
// it here rather than editing that (off-limits, shared) file.
export type MarkupStatus = z.infer<typeof markupStatusSchema>;

export interface ColumnOrValue {
  column?: string;
  value?: string;
}

export interface StatusSource {
  /**
   * Fixed status applied to every row (case-insensitive, trimmed, then
   * validated against markupStatusSchema up front — same normalization
   * discipline's fixed value already gets).
   */
  value?: MarkupStatus;
  /** Column holding Bluebeam's own status string, translated via statusMap. */
  column?: string;
  /**
   * Raw Bluebeam status (case-insensitive, trimmed) -> schema status. The
   * target (schema) side is also case-insensitive/trimmed before being
   * validated and used, so `--status-map "Open=OPEN"` normalizes to
   * `open` rather than being rejected. Required when `column` is set.
   */
  statusMap?: Record<string, MarkupStatus>;
}

export interface ImportMapping {
  sheet: ColumnOrValue;
  revision: ColumnOrValue;
  date: ColumnOrValue;
  discipline: ColumnOrValue;
  file: ColumnOrValue;
  status: StatusSource;
  notes?: ColumnOrValue;
  originalFile?: ColumnOrValue;
  /** Column with a comma-separated list of code section ids. */
  relatedCodeSections?: ColumnOrValue;
}

const DISCIPLINE_OPTIONS = disciplineSchema.options;
const STATUS_OPTIONS = markupStatusSchema.options;

/**
 * Validates the mapping itself against the CSV's actual headers — every
 * `column` reference must exist, and every fixed enum-like value
 * (discipline/status) must already be valid — so mapping mistakes are
 * reported once, up front, instead of as N duplicate per-row errors.
 */
export function validateMapping(mapping: ImportMapping, headers: string[]): string[] {
  const issues: string[] = [];
  const headerSet = new Set(headers);

  const checkColumnOrValue = (name: string, field: ColumnOrValue | undefined, required: boolean) => {
    if (!field || (field.column === undefined && field.value === undefined)) {
      if (required) issues.push(`No mapping provided for required field "${name}" (use --map-${name}=<column> or --${name}=<value>).`);
      return;
    }
    if (field.column !== undefined && field.value !== undefined) {
      issues.push(`Field "${name}" has both a column mapping and a fixed value — provide only one.`);
      return;
    }
    if (field.column !== undefined && !headerSet.has(field.column)) {
      issues.push(`Field "${name}" maps to column "${field.column}", which is not a header in this CSV.`);
    }
  };

  checkColumnOrValue("sheet", mapping.sheet, true);
  checkColumnOrValue("revision", mapping.revision, true);
  checkColumnOrValue("date", mapping.date, true);
  checkColumnOrValue("file", mapping.file, true);
  checkColumnOrValue("notes", mapping.notes, false);
  checkColumnOrValue("original-file", mapping.originalFile, false);
  checkColumnOrValue("related-code-sections", mapping.relatedCodeSections, false);

  if (mapping.discipline.column === undefined && mapping.discipline.value === undefined) {
    issues.push("No mapping provided for required field \"discipline\" (use --map-discipline=<column> or --discipline=<value>). Discipline is never inferred from a sheet prefix.");
  } else if (mapping.discipline.value !== undefined) {
    const normalized = mapping.discipline.value.trim().toLowerCase();
    if (!(DISCIPLINE_OPTIONS as readonly string[]).includes(normalized)) {
      issues.push(`--discipline "${mapping.discipline.value}" is not a valid discipline. Valid values: ${DISCIPLINE_OPTIONS.join(", ")}.`);
    }
  } else if (mapping.discipline.column !== undefined && !headerSet.has(mapping.discipline.column)) {
    issues.push(`Field "discipline" maps to column "${mapping.discipline.column}", which is not a header in this CSV.`);
  }

  if (mapping.status.value === undefined && mapping.status.column === undefined) {
    issues.push("No mapping provided for required field \"status\" (use --map-status=<column> --status-map \"BluebeamValue=schemaValue,...\" or --status=<value>).");
  } else if (mapping.status.value !== undefined && mapping.status.column !== undefined) {
    issues.push('Field "status" has both a column mapping and a fixed value — provide only one.');
  } else if (mapping.status.value !== undefined) {
    const normalized = mapping.status.value.trim().toLowerCase();
    if (!(STATUS_OPTIONS as readonly string[]).includes(normalized)) {
      issues.push(`--status "${mapping.status.value}" is not a valid status. Valid values: ${STATUS_OPTIONS.join(", ")}.`);
    }
  } else if (mapping.status.column !== undefined) {
    if (!headerSet.has(mapping.status.column)) {
      issues.push(`Field "status" maps to column "${mapping.status.column}", which is not a header in this CSV.`);
    }
    if (!mapping.status.statusMap || Object.keys(mapping.status.statusMap).length === 0) {
      issues.push('Field "status" maps to a column but has no --status-map — unknown Bluebeam status values would otherwise be silently guessed. Provide at least one mapping, e.g. --status-map "Open=open".');
    } else {
      for (const [bluebeamStatus, mapped] of Object.entries(mapping.status.statusMap)) {
        const normalizedTarget = mapped.trim().toLowerCase();
        if (!(STATUS_OPTIONS as readonly string[]).includes(normalizedTarget)) {
          issues.push(`--status-map targets invalid status "${mapped}" (for Bluebeam value "${bluebeamStatus}"). Valid values: ${STATUS_OPTIONS.join(", ")}.`);
        }
      }
    }
  }

  return issues;
}

interface FieldResolution {
  value: string | null;
  reason?: string;
}

function resolveColumnOrValue(name: string, field: ColumnOrValue | undefined, record: Record<string, string>): FieldResolution {
  if (!field) return { value: null, reason: `${name}: no mapping provided` };
  if (field.value !== undefined) return { value: field.value };
  if (field.column === undefined) return { value: null, reason: `${name}: no mapping provided` };
  const raw = record[field.column];
  if (raw === undefined || raw.trim() === "") {
    return { value: null, reason: `${name}: column "${field.column}" is empty on this row` };
  }
  return { value: raw.trim() };
}

const DATE_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_US_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Explicit calendar validation (year/month/day component checking, not
 * `Date` rollover) — the same numeric range is used for both accepted
 * input forms so e.g. "2026-02-30", "2026-04-31", and "2026-13-10" are
 * rejected exactly like their M/D/YYYY equivalents.
 */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= maxDay;
}

/**
 * Normalizes an explicitly-mapped date value to YYYY-MM-DD. Never guesses
 * an ambiguous format, and never accepts a calendar-invalid date (e.g. a
 * non-leap-year Feb 29, or a day past the actual end of its month) even
 * when the shape otherwise matches.
 */
export function normalizeDate(raw: string): { value: string } | { error: string } {
  const trimmed = raw.trim();

  const isoMatch = trimmed.match(DATE_ISO_RE);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!isValidCalendarDate(year, month, day)) {
      return { error: `unrecognized date "${raw}" — "${trimmed}" is not a real calendar date` };
    }
    return { value: trimmed };
  }

  const usMatch = trimmed.match(DATE_US_RE);
  if (usMatch) {
    const month = Number(usMatch[1]);
    const day = Number(usMatch[2]);
    const year = Number(usMatch[3]);
    if (!isValidCalendarDate(year, month, day)) {
      return { error: `unrecognized date "${raw}" — not a real calendar date` };
    }
    return { value: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  }

  return { error: `unrecognized date format "${raw}" — expected YYYY-MM-DD or M/D/YYYY (optionally with a time suffix, which is discarded)` };
}

function mapOneRow(row: CsvRow, mapping: ImportMapping): MappedRow {
  if (row.record === null) {
    return {
      kind: "unresolved",
      rowNumber: row.rowNumber,
      raw: null,
      reasons: [`column count mismatch: expected ${row.expectedColumns} column(s), row has ${row.actualColumns}`],
    };
  }
  const record = row.record;
  const reasons: string[] = [];

  const sheetR = resolveColumnOrValue("sheet", mapping.sheet, record);
  if (sheetR.reason) reasons.push(sheetR.reason);

  const revisionR = resolveColumnOrValue("revision", mapping.revision, record);
  let revision: number | null = null;
  if (revisionR.reason) {
    reasons.push(revisionR.reason);
  } else {
    const n = Number(revisionR.value);
    if (!Number.isFinite(n)) {
      reasons.push(`revision: "${revisionR.value}" is not a number`);
    } else {
      revision = n;
    }
  }

  const dateR = resolveColumnOrValue("date", mapping.date, record);
  let date: string | null = null;
  if (dateR.reason) {
    reasons.push(dateR.reason);
  } else {
    const normalized = normalizeDate(dateR.value!);
    if ("error" in normalized) reasons.push(`date: ${normalized.error}`);
    else date = normalized.value;
  }

  const disciplineR = resolveColumnOrValue("discipline", mapping.discipline, record);
  let discipline: MarkupEntry["discipline"] | null = null;
  if (disciplineR.reason) {
    reasons.push(disciplineR.reason);
  } else {
    const normalized = disciplineR.value!.trim().toLowerCase();
    if ((DISCIPLINE_OPTIONS as readonly string[]).includes(normalized)) {
      discipline = normalized as MarkupEntry["discipline"];
    } else {
      reasons.push(`discipline: "${disciplineR.value}" is not one of ${DISCIPLINE_OPTIONS.join(", ")} — never inferred from sheet number`);
    }
  }

  const fileR = resolveColumnOrValue("file", mapping.file, record);
  if (fileR.reason) reasons.push(fileR.reason);

  let status: MarkupStatus | null = null;
  if (mapping.status.value !== undefined) {
    const normalized = mapping.status.value.trim().toLowerCase();
    if ((STATUS_OPTIONS as readonly string[]).includes(normalized)) {
      status = normalized as MarkupStatus;
    } else {
      reasons.push(`status: "${mapping.status.value}" is not one of ${STATUS_OPTIONS.join(", ")}`);
    }
  } else if (mapping.status.column !== undefined) {
    const raw = record[mapping.status.column];
    if (raw === undefined || raw.trim() === "") {
      reasons.push(`status: column "${mapping.status.column}" is empty on this row`);
    } else {
      const key = raw.trim().toLowerCase();
      const entries = Object.entries(mapping.status.statusMap ?? {});
      const found = entries.find(([bluebeamStatus]) => bluebeamStatus.trim().toLowerCase() === key);
      if (found) {
        status = found[1].trim().toLowerCase() as MarkupStatus;
      } else {
        reasons.push(`status: unknown Bluebeam status "${raw.trim()}" — no --status-map entry for it; add one, e.g. --status-map "${raw.trim()}=open"`);
      }
    }
  } else {
    reasons.push("status: no mapping provided");
  }

  let notes: string | undefined;
  if (mapping.notes) {
    const r = resolveColumnOrValue("notes", mapping.notes, record);
    if (!r.reason && r.value) notes = r.value;
  }

  let originalFile: string | undefined;
  if (mapping.originalFile) {
    const r = resolveColumnOrValue("original-file", mapping.originalFile, record);
    if (!r.reason && r.value) originalFile = r.value;
  }

  let relatedCodeSections: string[] = [];
  if (mapping.relatedCodeSections) {
    const r = resolveColumnOrValue("related-code-sections", mapping.relatedCodeSections, record);
    if (!r.reason && r.value) {
      relatedCodeSections = r.value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  }

  if (reasons.length > 0) {
    return { kind: "unresolved", rowNumber: row.rowNumber, raw: record, reasons };
  }

  const candidate = {
    sheet: sheetR.value!,
    revision: revision!,
    date: date!,
    discipline: discipline!,
    file: fileR.value!,
    status: status!,
    ...(notes !== undefined ? { notes } : {}),
    ...(originalFile !== undefined ? { original_file: originalFile } : {}),
    related_code_sections: relatedCodeSections,
  };

  const parsed = markupEntrySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      kind: "unresolved",
      rowNumber: row.rowNumber,
      raw: record,
      reasons: parsed.error.issues.map((issue) => `schema: ${issue.path.join(".")} — ${issue.message}`),
    };
  }

  return {
    kind: "resolved",
    rowNumber: row.rowNumber,
    raw: record,
    entry: parsed.data,
    identity: deriveIdentity(parsed.data),
  };
}

export function mapRows(rows: CsvRow[], mapping: ImportMapping): MappedRow[] {
  return rows.map((row) => mapOneRow(row, mapping));
}
