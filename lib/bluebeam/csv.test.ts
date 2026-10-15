import { describe, expect, it } from "vitest";
import { CsvHeaderError, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a simple CSV with headers and rows", () => {
    const result = parseCsv("Sheet,Status\nA-101,Open\nA-102,Void\n");
    expect(result.headers).toEqual(["Sheet", "Status"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].record).toEqual({ Sheet: "A-101", Status: "Open" });
    expect(result.rows[1].record).toEqual({ Sheet: "A-102", Status: "Void" });
  });

  it("strips a UTF-8 BOM from the start of the file", () => {
    const result = parseCsv("﻿Sheet,Status\nA-101,Open\n");
    expect(result.headers).toEqual(["Sheet", "Status"]);
    expect(result.rows[0].record).toEqual({ Sheet: "A-101", Status: "Open" });
  });

  it("handles CRLF line endings", () => {
    const result = parseCsv("Sheet,Status\r\nA-101,Open\r\nA-102,Void\r\n");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].record).toEqual({ Sheet: "A-101", Status: "Open" });
  });

  it("handles a bare CR line ending", () => {
    const result = parseCsv("Sheet,Status\rA-101,Open\r");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].record).toEqual({ Sheet: "A-101", Status: "Open" });
  });

  it("parses quoted fields containing commas", () => {
    const result = parseCsv('Sheet,Notes\nA-101,"Fix door, and window"\n');
    expect(result.rows[0].record).toEqual({ Sheet: "A-101", Notes: "Fix door, and window" });
  });

  it("parses escaped double quotes inside a quoted field", () => {
    const result = parseCsv('Sheet,Notes\nA-101,"Say ""hello"" please"\n');
    expect(result.rows[0].record).toEqual({ Sheet: "A-101", Notes: 'Say "hello" please' });
  });

  it("parses a multiline quoted field and tracks the row's starting line", () => {
    const csv = 'Sheet,Notes\nA-101,"Line one\nLine two"\nA-102,fine\n';
    const result = parseCsv(csv);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].record).toEqual({ Sheet: "A-101", Notes: "Line one\nLine two" });
    expect(result.rows[0].rowNumber).toBe(2);
    // The second data row starts after the embedded newline, so it's line 4, not line 3.
    expect(result.rows[1].rowNumber).toBe(4);
  });

  it("preserves empty cells", () => {
    const result = parseCsv("Sheet,Notes,Status\nA-101,,Open\n");
    expect(result.rows[0].record).toEqual({ Sheet: "A-101", Notes: "", Status: "Open" });
  });

  it("preserves raw values alongside the mapped record", () => {
    const result = parseCsv("Sheet,Status\n A-101 ,Open\n");
    expect(result.rows[0].raw).toEqual([" A-101 ", "Open"]);
  });

  it("flags a row with too few columns instead of dropping or misaligning it", () => {
    const result = parseCsv("Sheet,Notes,Status\nA-101,onlytwo\nA-102,x,Open\n");
    expect(result.rows[0].columnCountMismatch).toBe(true);
    expect(result.rows[0].record).toBeNull();
    expect(result.rows[0].expectedColumns).toBe(3);
    expect(result.rows[0].actualColumns).toBe(2);
    expect(result.rows[1].columnCountMismatch).toBe(false);
  });

  it("flags a row with too many columns", () => {
    const result = parseCsv("Sheet,Status\nA-101,Open,Extra\n");
    expect(result.rows[0].columnCountMismatch).toBe(true);
    expect(result.rows[0].record).toBeNull();
  });

  it("throws CsvHeaderError on an empty header cell", () => {
    expect(() => parseCsv("Sheet,,Status\nA-101,x,Open\n")).toThrow(CsvHeaderError);
  });

  it("throws CsvHeaderError on a duplicate header, listing all issues", () => {
    let caught: unknown;
    try {
      parseCsv("Sheet,Status,Sheet\nA-101,Open,dup\n");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CsvHeaderError);
    expect((caught as CsvHeaderError).issues.some((issue) => issue.includes('Header "Sheet"'))).toBe(true);
  });

  it("throws CsvHeaderError on a completely empty file", () => {
    expect(() => parseCsv("")).toThrow(CsvHeaderError);
  });

  it("trims header whitespace for column-name matching", () => {
    const result = parseCsv(" Sheet , Status \nA-101,Open\n");
    expect(result.headers).toEqual(["Sheet", "Status"]);
  });
});

describe("parseCsv — genuinely blank physical lines", () => {
  it("skips one trailing blank line, excluding it from rows and reporting its line number", () => {
    const result = parseCsv("Sheet,Status\nA-101,Open\n\n");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].record).toEqual({ Sheet: "A-101", Status: "Open" });
    expect(result.blankRowNumbers).toEqual([3]);
  });

  it("skips multiple trailing blank lines, each reported with its own line number", () => {
    const result = parseCsv("Sheet,Status\nA-101,Open\n\n\n");
    expect(result.rows).toHaveLength(1);
    expect(result.blankRowNumbers).toEqual([3, 4]);
  });

  it("skips a blank line between two valid records without disturbing either one", () => {
    const result = parseCsv("Sheet,Status\nA-101,Open\n\nA-102,Void\n");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].record).toEqual({ Sheet: "A-101", Status: "Open" });
    expect(result.rows[0].rowNumber).toBe(2);
    expect(result.rows[1].record).toEqual({ Sheet: "A-102", Status: "Void" });
    expect(result.rows[1].rowNumber).toBe(4);
    expect(result.blankRowNumbers).toEqual([3]);
  });

  it("skips a CRLF blank line the same way as an LF blank line", () => {
    const result = parseCsv("Sheet,Status\r\nA-101,Open\r\n\r\nA-102,Void\r\n");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].rowNumber).toBe(2);
    expect(result.rows[1].rowNumber).toBe(4);
    expect(result.blankRowNumbers).toEqual([3]);
  });

  it("skips a blank line immediately after a multiline quoted field, preserving correct row numbers on both sides", () => {
    const csv = 'Sheet,Notes\nA-101,"Line one\nLine two"\n\nA-102,fine\n';
    const result = parseCsv(csv);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].record).toEqual({ Sheet: "A-101", Notes: "Line one\nLine two" });
    expect(result.rows[0].rowNumber).toBe(2);
    expect(result.rows[1].record).toEqual({ Sheet: "A-102", Notes: "fine" });
    // Line 3 is consumed by the embedded newline inside the quoted field;
    // line 4 is the blank line; A-102 starts at line 5.
    expect(result.rows[1].rowNumber).toBe(5);
    expect(result.blankRowNumbers).toEqual([4]);
  });

  it("does NOT treat a quoted empty field on its own line as blank", () => {
    const result = parseCsv('Notes\nsomething\n""\n');
    expect(result.blankRowNumbers).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].record).toEqual({ Notes: "" });
  });

  it("does NOT treat a delimiter-only row as blank", () => {
    const result = parseCsv("A,B\nx,y\n,\n");
    expect(result.blankRowNumbers).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].record).toEqual({ A: "", B: "" });
  });

  it("does NOT treat a whitespace-only row as blank", () => {
    const result = parseCsv("Notes\nsomething\n   \n");
    expect(result.blankRowNumbers).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].record).toEqual({ Notes: "   " });
  });

  it("keeps a malformed (column-count-mismatch) row unresolved-eligible even when adjacent to a genuinely blank row", () => {
    const result = parseCsv("A,B,C\nx,y\n\np,q,r\n");
    expect(result.blankRowNumbers).toEqual([3]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].columnCountMismatch).toBe(true);
    expect(result.rows[0].record).toBeNull();
    expect(result.rows[0].rowNumber).toBe(2);
    expect(result.rows[1].columnCountMismatch).toBe(false);
    expect(result.rows[1].record).toEqual({ A: "p", B: "q", C: "r" });
    expect(result.rows[1].rowNumber).toBe(4);
  });
});
