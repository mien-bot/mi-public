import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { mapRows, normalizeDate, validateMapping, type ImportMapping } from "./mapping";
import type { ResolvedMarkupRow, UnresolvedMarkupRow } from "./types";

const BASE_CSV = [
  "Page Label,Date Created,Status,Comments",
  "A-101,7/15/2026,Open,Fix door swing",
  "A-102,2026-07-16,Void,Relocate outlet",
  "A-103,7/17/2026,Mystery,Unclear",
].join("\n");

function baseMapping(overrides: Partial<ImportMapping> = {}): ImportMapping {
  return {
    sheet: { column: "Page Label" },
    revision: { value: "3" },
    date: { column: "Date Created" },
    discipline: { value: "architectural" },
    file: { value: "originals/round-3.pdf" },
    status: { column: "Status", statusMap: { Open: "open", Void: "addressed" } },
    notes: { column: "Comments" },
    ...overrides,
  };
}

describe("normalizeDate", () => {
  it("passes through an ISO date unchanged", () => {
    expect(normalizeDate("2026-07-15")).toEqual({ value: "2026-07-15" });
  });

  it("converts M/D/YYYY to YYYY-MM-DD", () => {
    expect(normalizeDate("7/5/2026")).toEqual({ value: "2026-07-05" });
  });

  it("discards a trailing time suffix on M/D/YYYY", () => {
    expect(normalizeDate("7/5/2026 3:04 PM")).toEqual({ value: "2026-07-05" });
  });

  it("rejects an unrecognized format instead of guessing", () => {
    const result = normalizeDate("15 July 2026");
    expect("error" in result).toBe(true);
  });

  describe("strict calendar validation", () => {
    const rejects = [
      "2026-02-29", // 2026 is not a leap year
      "2026-02-30",
      "2026-04-31", // April has 30 days
      "2026-00-10", // month 0
      "2026-13-10", // month 13
      "2/29/2026",
      "4/31/2026",
      "0/10/2026",
      "13/10/2026",
    ];
    it.each(rejects)("rejects the impossible calendar date %s", (raw) => {
      const result = normalizeDate(raw);
      expect("error" in result).toBe(true);
    });

    it("accepts Feb 29 on an actual leap year (ISO form)", () => {
      expect(normalizeDate("2024-02-29")).toEqual({ value: "2024-02-29" });
    });

    it("accepts Feb 29 on an actual leap year (M/D/YYYY form)", () => {
      expect(normalizeDate("2/29/2024")).toEqual({ value: "2024-02-29" });
    });

    it("accepts valid month-end dates for months with fewer than 31 days", () => {
      expect(normalizeDate("2026-04-30")).toEqual({ value: "2026-04-30" });
      expect(normalizeDate("4/30/2026")).toEqual({ value: "2026-04-30" });
      expect(normalizeDate("2026-02-28")).toEqual({ value: "2026-02-28" });
    });

    it("still discards a valid time suffix alongside strict date validation", () => {
      expect(normalizeDate("2/29/2024 3:04 PM")).toEqual({ value: "2024-02-29" });
    });
  });
});

describe("validateMapping", () => {
  it("passes for a fully specified mapping", () => {
    const { headers } = parseCsv(BASE_CSV);
    expect(validateMapping(baseMapping(), headers)).toEqual([]);
  });

  it("flags a required field with no mapping at all", () => {
    const { headers } = parseCsv(BASE_CSV);
    const mapping = baseMapping({ sheet: {} });
    const issues = validateMapping(mapping, headers);
    expect(issues.some((i) => i.includes('"sheet"'))).toBe(true);
  });

  it("flags a column mapping that doesn't exist in the CSV headers", () => {
    const { headers } = parseCsv(BASE_CSV);
    const mapping = baseMapping({ sheet: { column: "Nonexistent Column" } });
    const issues = validateMapping(mapping, headers);
    expect(issues.some((i) => i.includes("Nonexistent Column"))).toBe(true);
  });

  it("flags a field with both a column and a fixed value", () => {
    const { headers } = parseCsv(BASE_CSV);
    const mapping = baseMapping({ sheet: { column: "Page Label", value: "A-999" } });
    const issues = validateMapping(mapping, headers);
    expect(issues.some((i) => i.includes("both a column mapping and a fixed value"))).toBe(true);
  });

  it("flags an invalid fixed discipline value", () => {
    const { headers } = parseCsv(BASE_CSV);
    const mapping = baseMapping({ discipline: { value: "carpentry" } });
    const issues = validateMapping(mapping, headers);
    expect(issues.some((i) => i.includes("not a valid discipline"))).toBe(true);
  });

  it("requires a status-map when status is column-sourced", () => {
    const { headers } = parseCsv(BASE_CSV);
    const mapping = baseMapping({ status: { column: "Status" } });
    const issues = validateMapping(mapping, headers);
    expect(issues.some((i) => i.includes("no --status-map"))).toBe(true);
  });

  it("flags a status-map target that isn't a valid schema status", () => {
    const { headers } = parseCsv(BASE_CSV);
    const mapping = baseMapping({ status: { column: "Status", statusMap: { Open: "kinda-open" as never } } });
    const issues = validateMapping(mapping, headers);
    expect(issues.some((i) => i.includes("invalid status"))).toBe(true);
  });

  it("accepts a mixed-case fixed --status value, same as discipline's case-insensitivity", () => {
    const { headers } = parseCsv(BASE_CSV);
    const mapping = baseMapping({ status: { value: "Open" as never } });
    expect(validateMapping(mapping, headers)).toEqual([]);
  });

  it("accepts an uppercase fixed --status value", () => {
    const { headers } = parseCsv(BASE_CSV);
    const mapping = baseMapping({ status: { value: "ADDRESSED" as never } });
    expect(validateMapping(mapping, headers)).toEqual([]);
  });

  it("still rejects an invalid fixed --status value regardless of case", () => {
    const { headers } = parseCsv(BASE_CSV);
    const mapping = baseMapping({ status: { value: "Bogus" as never } });
    const issues = validateMapping(mapping, headers);
    expect(issues.some((i) => i.includes("not a valid status"))).toBe(true);
  });

  it("accepts a mixed-case --status-map target value", () => {
    const { headers } = parseCsv(BASE_CSV);
    const mapping = baseMapping({ status: { column: "Status", statusMap: { Open: "OPEN" as never, Void: "Addressed" as never } } });
    expect(validateMapping(mapping, headers)).toEqual([]);
  });
});

describe("mapRows", () => {
  it("resolves rows with valid mappings and translates status via statusMap", () => {
    const { rows } = parseCsv(BASE_CSV);
    const mapped = mapRows(rows.slice(0, 2), baseMapping());
    expect(mapped).toHaveLength(2);
    const [first, second] = mapped as ResolvedMarkupRow[];
    expect(first.kind).toBe("resolved");
    expect(first.entry).toMatchObject({
      sheet: "A-101",
      revision: 3,
      date: "2026-07-15",
      discipline: "architectural",
      file: "originals/round-3.pdf",
      status: "open",
      notes: "Fix door swing",
    });
    expect(second.entry.status).toBe("addressed");
  });

  it("leaves a row unresolved when its status has no statusMap entry, never guessing", () => {
    const { rows } = parseCsv(BASE_CSV);
    const mapped = mapRows([rows[2]], baseMapping());
    expect(mapped[0].kind).toBe("unresolved");
    const unresolved = mapped[0] as UnresolvedMarkupRow;
    expect(unresolved.reasons.some((r) => r.includes("unknown Bluebeam status"))).toBe(true);
  });

  it("leaves a row unresolved when a mapped column is empty", () => {
    const csv = "Page Label,Date Created,Status\n,2026-07-15,Open\n";
    const { rows } = parseCsv(csv);
    const mapped = mapRows(rows, baseMapping({ status: { column: "Status", statusMap: { Open: "open" } }, notes: undefined }));
    expect(mapped[0].kind).toBe("unresolved");
    const unresolved = mapped[0] as UnresolvedMarkupRow;
    expect(unresolved.reasons.some((r) => r.startsWith("sheet:"))).toBe(true);
  });

  it("carries a column-count mismatch row straight through as unresolved", () => {
    const csv = "Page Label,Date Created,Status\nA-101,2026-07-15\n";
    const { rows } = parseCsv(csv);
    const mapped = mapRows(rows, baseMapping({ status: { column: "Status", statusMap: { Open: "open" } }, notes: undefined }));
    expect(mapped[0].kind).toBe("unresolved");
    const unresolved = mapped[0] as UnresolvedMarkupRow;
    expect(unresolved.raw).toBeNull();
    expect(unresolved.reasons[0]).toContain("column count mismatch");
  });

  it("rejects a non-numeric revision instead of coercing it", () => {
    const csv = "Page Label,Date Created,Status\nA-101,2026-07-15,Open\n";
    const { rows } = parseCsv(csv);
    const mapped = mapRows(
      rows,
      baseMapping({ revision: { value: "not-a-number" }, status: { column: "Status", statusMap: { Open: "open" } }, notes: undefined }),
    );
    expect(mapped[0].kind).toBe("unresolved");
  });

  it("normalizes a mixed-case fixed --status value to its lowercase schema form", () => {
    const { rows } = parseCsv(BASE_CSV);
    const mapped = mapRows([rows[0]], baseMapping({ status: { value: "Open" as never } }));
    expect(mapped[0].kind).toBe("resolved");
    expect((mapped[0] as ResolvedMarkupRow).entry.status).toBe("open");
  });

  it("normalizes a mixed-case --status-map target value to its lowercase schema form", () => {
    const { rows } = parseCsv(BASE_CSV);
    const mapped = mapRows([rows[1]], baseMapping({ status: { column: "Status", statusMap: { Void: "Addressed" as never } } }));
    expect(mapped[0].kind).toBe("resolved");
    expect((mapped[0] as ResolvedMarkupRow).entry.status).toBe("addressed");
  });

  it("splits related-code-sections on commas", () => {
    // The Codes column itself contains a comma-separated list, so it must be quoted in the CSV.
    const quotedCsv = 'Page Label,Date Created,Status,Codes\nA-101,2026-07-15,Open,"ibc-2021-1004, ibc-2021-1005"\n';
    const { rows } = parseCsv(quotedCsv);
    const mapped = mapRows(
      rows,
      baseMapping({
        status: { column: "Status", statusMap: { Open: "open" } },
        notes: undefined,
        relatedCodeSections: { column: "Codes" },
      }),
    );
    expect(mapped[0].kind).toBe("resolved");
    expect((mapped[0] as ResolvedMarkupRow).entry.related_code_sections).toEqual(["ibc-2021-1004", "ibc-2021-1005"]);
  });
});
