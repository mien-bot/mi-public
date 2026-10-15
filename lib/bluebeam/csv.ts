/**
 * Dependency-free RFC 4180-style CSV parser for Bluebeam Markups List
 * exports (and any other well-formed CSV). No npm dependency is used or
 * added — this is a small hand-written tokenizer, deliberately kept in one
 * file so its behavior is easy to audit.
 *
 * Handles: UTF-8 BOM, CRLF/LF line endings (and a bare `\r`), quoted fields
 * containing commas/newlines, `""`-escaped quotes inside quoted fields, and
 * empty cells. Never silently drops a malformed row — a row whose field
 * count doesn't match the header row is returned with `record: null` and
 * `columnCountMismatch: true` instead of being parsed or discarded, so the
 * caller can report it explicitly.
 *
 * A genuinely blank physical line (nothing at all between two line
 * terminators — not even whitespace) is a distinct case from a malformed
 * row: it is never a real data record, so it is excluded from `rows` and
 * its source line number is reported separately via `blankRowNumbers`
 * instead of being surfaced as a phantom one-column `columnCountMismatch`
 * row. This is intentionally narrow — a quoted empty field (`""` on its own
 * line), a delimiter-only row (`,,,`), and a whitespace-only row (`"   "`
 * with no delimiters) all involve at least one source character (a quote,
 * a comma, or a space) and are therefore never classified as blank; they
 * keep their existing record/columnCountMismatch handling unchanged.
 */

export interface CsvRow {
  /** 1-based source line number where this record begins (header row is line 1). */
  rowNumber: number;
  /** Raw field values in column order, exactly as they appeared (no trimming). */
  raw: string[];
  /** header -> raw value, or null when this row's column count doesn't match the header. */
  record: Record<string, string> | null;
  columnCountMismatch: boolean;
  expectedColumns: number;
  actualColumns: number;
}

export interface CsvParseResult {
  headers: string[];
  rows: CsvRow[];
  /**
   * 1-based source line numbers of genuinely blank physical data records
   * (encountered after the header row), in ascending order. These lines
   * are excluded from `rows` entirely — they are never a data row, never
   * `columnCountMismatch`, and never block anything downstream — but their
   * line numbers are preserved here so callers can report exactly which
   * source lines were skipped and why.
   */
  blankRowNumbers: number[];
}

export class CsvHeaderError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid CSV headers:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "CsvHeaderError";
  }
}

/** Strips a leading UTF-8 BOM (decoded as U+FEFF) if present. */
function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

interface Tokenized {
  records: string[][];
  startLines: number[];
  /**
   * Parallel to `records`/`startLines`: true when the record was pushed
   * without ever processing a single source character (no comma, no quote,
   * no regular character) — i.e. the physical line between two terminators
   * was completely empty. A quoted empty field, a delimiter-only row, and a
   * whitespace-only row all involve at least one source character and are
   * therefore `false` here.
   */
  blankFlags: boolean[];
}

function tokenize(input: string): Tokenized {
  const records: string[][] = [];
  const startLines: number[] = [];
  const blankFlags: boolean[] = [];

  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  let recordHasContent = false;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    startLines.push(recordStartLine);
    blankFlags.push(!recordHasContent);
    record = [];
    recordHasContent = false;
  };

  let i = 0;
  const len = input.length;
  while (i < len) {
    const c = input[i];

    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (c === "\n") line += 1;
      field += c;
      i += 1;
      continue;
    }

    if (c === '"' && field.length === 0) {
      inQuotes = true;
      recordHasContent = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      pushField();
      recordHasContent = true;
      i += 1;
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && input[i + 1] === "\n") i += 1;
      pushRecord();
      line += 1;
      recordStartLine = line;
      i += 1;
      continue;
    }
    field += c;
    recordHasContent = true;
    i += 1;
  }

  if (recordHasContent || field.length > 0 || record.length > 0) {
    pushRecord();
  }

  return { records, startLines, blankFlags };
}

function validateHeaders(headers: string[]): string[] {
  const issues: string[] = [];
  if (headers.length === 0) {
    issues.push("CSV file has no header row.");
    return issues;
  }

  headers.forEach((raw, index) => {
    if (raw.trim() === "") {
      issues.push(`Column ${index + 1} has an empty/missing header name.`);
    }
  });

  const byName = new Map<string, number[]>();
  headers.forEach((raw, index) => {
    const name = raw.trim();
    if (name === "") return;
    const indices = byName.get(name) ?? [];
    indices.push(index + 1);
    byName.set(name, indices);
  });
  for (const [name, indices] of byName) {
    if (indices.length > 1) {
      issues.push(`Header "${name}" appears ${indices.length} times (columns ${indices.join(", ")}).`);
    }
  }

  return issues;
}

/**
 * Parses CSV text into a header list and a row list. Throws `CsvHeaderError`
 * (with every issue found, not just the first) if the header row is empty,
 * has a blank column name, or has a duplicate column name — callers should
 * catch this and stop before reading any data, since column-name-based
 * mapping cannot be trusted otherwise.
 */
export function parseCsv(input: string): CsvParseResult {
  const normalized = stripBom(input);
  const { records, startLines, blankFlags } = tokenize(normalized);

  if (records.length === 0) {
    throw new CsvHeaderError(["CSV file is empty."]);
  }

  const headers = records[0];
  const headerIssues = validateHeaders(headers);
  if (headerIssues.length > 0) {
    throw new CsvHeaderError(headerIssues);
  }

  const trimmedHeaders = headers.map((h) => h.trim());
  const expectedColumns = trimmedHeaders.length;

  const rows: CsvRow[] = [];
  const blankRowNumbers: number[] = [];
  for (let r = 1; r < records.length; r += 1) {
    const rowNumber = startLines[r];

    if (blankFlags[r]) {
      // A genuinely blank physical line — never a data row, never a
      // columnCountMismatch, excluded from `rows` entirely. Its line
      // number is preserved so callers can report it explicitly instead
      // of losing the provenance of what was skipped and why.
      blankRowNumbers.push(rowNumber);
      continue;
    }

    const raw = records[r];
    const actualColumns = raw.length;
    const columnCountMismatch = actualColumns !== expectedColumns;

    let record: Record<string, string> | null = null;
    if (!columnCountMismatch) {
      record = {};
      trimmedHeaders.forEach((header, index) => {
        record![header] = raw[index];
      });
    }

    rows.push({
      rowNumber,
      raw,
      record,
      columnCountMismatch,
      expectedColumns,
      actualColumns,
    });
  }

  return { headers: trimmedHeaders, rows, blankRowNumbers };
}
