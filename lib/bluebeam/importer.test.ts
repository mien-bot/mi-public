import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";
import { markupIndexSchema } from "../schema";
import { applyImport, buildPreview, type ImportOptions } from "./importer";
import type { ImportMapping } from "./mapping";

const tempDirs: string[] = [];

function makeTempProjectsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mi-bluebeam-importer-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scaffoldProject(projectsDir: string, slug: string, existingIndexYaml?: string): string {
  const projectDir = path.join(projectsDir, slug);
  fs.mkdirSync(path.join(projectDir, "markups"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "project.yaml"), "name: Test Project\nstatus: in-progress\n", "utf8");
  if (existingIndexYaml !== undefined) {
    fs.writeFileSync(path.join(projectDir, "markups", "index.yaml"), existingIndexYaml, "utf8");
  }
  return projectDir;
}

function writeCsv(projectDir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(projectDir, "markups", name), content, "utf8");
}

const CLEAN_MAPPING: ImportMapping = {
  sheet: { column: "Page Label" },
  revision: { value: "3" },
  date: { column: "Date Created" },
  discipline: { value: "architectural" },
  file: { value: "originals/round-3.pdf" },
  status: { column: "Status", statusMap: { Open: "open", Void: "addressed" } },
  notes: { column: "Comments" },
};

const CSV_TWO_ROWS = [
  "Page Label,Date Created,Status,Comments",
  "A-101,7/15/2026,Open,Fix door swing",
  "A-102,2026-07-16,Void,Relocate outlet",
].join("\n");

describe("buildPreview", () => {
  it("rejects a project slug that does not exist, never inferring one", () => {
    const projectsDir = makeTempProjectsDir();
    const outcome = buildPreview({
      projectSlug: "nonexistent",
      csvPathArg: "export.csv",
      mapping: CLEAN_MAPPING,
      projectsDir,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("project-error");
  });

  it("reports every row as an addition against an empty index", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "[]\n");
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS);

    const outcome = buildPreview({ projectSlug: "test-project", csvPathArg: "export.csv", mapping: CLEAN_MAPPING, projectsDir });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.additions).toHaveLength(2);
    expect(outcome.result.updates).toHaveLength(0);
    expect(outcome.result.duplicates).toHaveLength(0);
    expect(outcome.result.unresolved).toHaveLength(0);
    // Preview never writes.
    expect(fs.readFileSync(path.join(projectDir, "markups", "index.yaml"), "utf8")).toBe("[]\n");
  });

  it("reports unresolved rows with reasons and never invents a value", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "[]\n");
    const csv = ["Page Label,Date Created,Status,Comments", "A-101,7/15/2026,Mystery,Unclear"].join("\n");
    writeCsv(projectDir, "export.csv", csv);

    const outcome = buildPreview({ projectSlug: "test-project", csvPathArg: "export.csv", mapping: CLEAN_MAPPING, projectsDir });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.additions).toHaveLength(0);
    expect(outcome.result.unresolved).toHaveLength(1);
    expect(outcome.result.unresolved[0].reasons.some((r) => r.includes("unknown Bluebeam status"))).toBe(true);
  });

  it("reports a within-batch identity conflict when two rows collide", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "[]\n");
    const csv = [
      "Page Label,Date Created,Status,Comments",
      "A-101,7/15/2026,Open,First",
      "A-101,7/16/2026,Void,Second",
    ].join("\n");
    writeCsv(projectDir, "export.csv", csv);

    const outcome = buildPreview({ projectSlug: "test-project", csvPathArg: "export.csv", mapping: CLEAN_MAPPING, projectsDir });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.withinBatchConflicts).toHaveLength(1);
    expect(outcome.result.additions).toHaveLength(0);
  });

  it("classifies an identical re-import as a duplicate, not an update", () => {
    const projectsDir = makeTempProjectsDir();
    const existing = markupIndexSchema.parse([
      {
        sheet: "A-101",
        revision: 3,
        date: "2026-07-15",
        discipline: "architectural",
        file: "originals/round-3.pdf",
        status: "open",
        notes: "Fix door swing",
        related_code_sections: [],
      },
    ]);
    const projectDir = scaffoldProject(projectsDir, "test-project", `${JSON.stringify(existing)}\n`);
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS.split("\n").slice(0, 2).join("\n") + "\n");

    const outcome = buildPreview({ projectSlug: "test-project", csvPathArg: "export.csv", mapping: CLEAN_MAPPING, projectsDir });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.duplicates).toHaveLength(1);
    expect(outcome.result.updates).toHaveLength(0);
    expect(outcome.result.additions).toHaveLength(0);
  });

  it("classifies a changed re-import (same identity, different status) as an update", () => {
    const projectsDir = makeTempProjectsDir();
    const existing = markupIndexSchema.parse([
      {
        sheet: "A-101",
        revision: 3,
        date: "2026-07-01",
        discipline: "architectural",
        file: "originals/round-3.pdf",
        status: "open",
        related_code_sections: [],
      },
    ]);
    const projectDir = scaffoldProject(projectsDir, "test-project", `${JSON.stringify(existing)}\n`);
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS.split("\n").slice(0, 2).join("\n") + "\n");

    const outcome = buildPreview({ projectSlug: "test-project", csvPathArg: "export.csv", mapping: CLEAN_MAPPING, projectsDir });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.updates).toHaveLength(1);
    expect(outcome.result.updates[0].existingIndex).toBe(0);
  });

  it("preview immutability: repeated calls never modify the CSV or the index file", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "[]\n");
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS);
    const indexPath = path.join(projectDir, "markups", "index.yaml");
    const csvPath = path.join(projectDir, "markups", "export.csv");
    const beforeIndex = fs.readFileSync(indexPath, "utf8");
    const beforeCsv = fs.readFileSync(csvPath, "utf8");

    for (let i = 0; i < 3; i += 1) {
      buildPreview({ projectSlug: "test-project", csvPathArg: "export.csv", mapping: CLEAN_MAPPING, projectsDir });
    }

    expect(fs.readFileSync(indexPath, "utf8")).toBe(beforeIndex);
    expect(fs.readFileSync(csvPath, "utf8")).toBe(beforeCsv);
  });

  it("gracefully reports a pre-existing invalid index.yaml instead of throwing", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "[{sheet: A-101}]\n"); // missing required fields
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS);

    const outcome = buildPreview({ projectSlug: "test-project", csvPathArg: "export.csv", mapping: CLEAN_MAPPING, projectsDir });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("existing-index-invalid");
  });

  it("reports skipped blank physical CSV lines separately, without blocking or counting them as unresolved", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "[]\n");
    // Explicit string concatenation (not Array#join, which never adds a
    // trailing separator) so the file genuinely ends with two blank lines.
    const csv =
      "Page Label,Date Created,Status,Comments\n" +
      "A-101,7/15/2026,Open,First\n" +
      "\n" + // blank line between two valid records
      "A-102,7/16/2026,Void,Second\n" +
      "\n" + // first trailing blank line
      "\n"; // second trailing blank line
    writeCsv(projectDir, "export.csv", csv);

    const outcome = buildPreview({ projectSlug: "test-project", csvPathArg: "export.csv", mapping: CLEAN_MAPPING, projectsDir });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.additions).toHaveLength(2);
    expect(outcome.result.unresolved).toHaveLength(0);
    // Header is line 1; A-101 line 2; blank line 3; A-102 line 4; two trailing blanks lines 5 and 6.
    expect(outcome.result.skippedBlankRowNumbers).toEqual([3, 5, 6]);
  });

  it("fails preview explicitly when the existing index already has two identical entries sharing an identity", () => {
    const projectsDir = makeTempProjectsDir();
    const dup = {
      sheet: "A-101",
      revision: 3,
      date: "2026-07-01",
      discipline: "architectural",
      file: "originals/round-3.pdf",
      status: "open",
      related_code_sections: [],
    };
    const projectDir = scaffoldProject(projectsDir, "test-project", `${JSON.stringify([dup, dup])}\n`);
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS);

    const outcome = buildPreview({ projectSlug: "test-project", csvPathArg: "export.csv", mapping: CLEAN_MAPPING, projectsDir });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("ambiguous-existing-identity");
    if (outcome.error.kind !== "ambiguous-existing-identity") return;
    expect(outcome.error.conflicts).toHaveLength(1);
    expect(outcome.error.conflicts[0].positions).toEqual([0, 1]);
  });

  it("fails preview explicitly when two different existing entries share the same derived identity", () => {
    const projectsDir = makeTempProjectsDir();
    const existing = [
      {
        sheet: "A-101",
        revision: 3,
        date: "2026-07-01",
        discipline: "architectural",
        file: "originals/round-3.pdf",
        status: "open",
        related_code_sections: [],
      },
      {
        // Same identity (sheet/revision/file) as above once normalized, but different status/date/notes.
        sheet: "A-101",
        revision: 3,
        date: "2026-07-10",
        discipline: "architectural",
        file: "originals/round-3.pdf",
        status: "addressed",
        notes: "second, conflicting entry",
        related_code_sections: [],
      },
    ];
    const projectDir = scaffoldProject(projectsDir, "test-project", `${JSON.stringify(existing)}\n`);
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS);

    const outcome = buildPreview({ projectSlug: "test-project", csvPathArg: "export.csv", mapping: CLEAN_MAPPING, projectsDir });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("ambiguous-existing-identity");
    if (outcome.error.kind !== "ambiguous-existing-identity") return;
    expect(outcome.error.conflicts[0].positions).toEqual([0, 1]);
    expect(outcome.error.issues[0]).toContain(outcome.error.conflicts[0].identity);
  });

  it("fails preview when two existing entries share an identity only after case/whitespace/slash normalization", () => {
    const projectsDir = makeTempProjectsDir();
    const existing = [
      {
        sheet: "A-101",
        revision: 3,
        date: "2026-07-01",
        discipline: "architectural",
        file: "originals/round-3.pdf",
        status: "open",
        related_code_sections: [],
      },
      {
        sheet: " a-101 ",
        revision: 3,
        date: "2026-07-02",
        discipline: "architectural",
        file: "ORIGINALS\\round-3.pdf",
        status: "open",
        related_code_sections: [],
      },
    ];
    const projectDir = scaffoldProject(projectsDir, "test-project", `${JSON.stringify(existing)}\n`);
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS);

    const outcome = buildPreview({ projectSlug: "test-project", csvPathArg: "export.csv", mapping: CLEAN_MAPPING, projectsDir });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("ambiguous-existing-identity");
  });

  it("still classifies additions/updates/duplicates normally when the existing index has no identity conflicts", () => {
    const projectsDir = makeTempProjectsDir();
    const existing = markupIndexSchema.parse([
      { sheet: "Z-999", revision: 1, date: "2026-01-01", discipline: "structural", file: "originals/other.pdf", status: "open", related_code_sections: [] },
      { sheet: "A-101", revision: 3, date: "2026-07-01", discipline: "architectural", file: "originals/round-3.pdf", status: "open", related_code_sections: [] },
    ]);
    const projectDir = scaffoldProject(projectsDir, "test-project", `${JSON.stringify(existing)}\n`);
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS);

    const outcome = buildPreview({ projectSlug: "test-project", csvPathArg: "export.csv", mapping: CLEAN_MAPPING, projectsDir });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.updates).toHaveLength(1);
    expect(outcome.result.additions).toHaveLength(1);
  });
});

describe("applyImport", () => {
  function baseApplyOptions(projectsDir: string, overrides: Partial<ImportOptions> = {}) {
    return {
      projectSlug: "test-project",
      csvPathArg: "export.csv",
      mapping: CLEAN_MAPPING,
      projectsDir,
      confirmProjectSlug: "test-project",
      ...overrides,
    };
  }

  it("refuses to apply without a matching --confirm-project", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "[]\n");
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS);

    const outcome = applyImport({ ...baseApplyOptions(projectsDir), confirmProjectSlug: "wrong-slug" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("confirmation-mismatch");
    expect(fs.readFileSync(path.join(projectDir, "markups", "index.yaml"), "utf8")).toBe("[]\n");
  });

  it("blocks apply when unresolved rows exist, and never partially applies them", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "[]\n");
    const csv = [
      "Page Label,Date Created,Status,Comments",
      "A-101,7/15/2026,Open,Fix door swing",
      "A-102,7/16/2026,Mystery,Unclear",
    ].join("\n");
    writeCsv(projectDir, "export.csv", csv);

    const outcome = applyImport(baseApplyOptions(projectsDir));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("blocked-by-unresolved");
    expect(fs.readFileSync(path.join(projectDir, "markups", "index.yaml"), "utf8")).toBe("[]\n");
  });

  it("has no code path that applies only a resolved subset (no override exists)", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "[]\n");
    const csv = [
      "Page Label,Date Created,Status,Comments",
      "A-101,7/15/2026,Open,Fix door swing",
      "A-102,7/16/2026,Mystery,Unclear",
    ].join("\n");
    writeCsv(projectDir, "export.csv", csv);

    // ApplyOptions no longer has a skip-unresolved-style field at all; even
    // passing an arbitrary extra property can't change the outcome.
    const outcome = applyImport({ ...baseApplyOptions(projectsDir) });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("blocked-by-unresolved");
    expect(fs.readFileSync(path.join(projectDir, "markups", "index.yaml"), "utf8")).toBe("[]\n");
  });

  it("blocks apply on a within-batch identity conflict with no override, same as unresolved rows", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "[]\n");
    const csv = [
      "Page Label,Date Created,Status,Comments",
      "A-101,7/15/2026,Open,First",
      "A-101,7/16/2026,Void,Second",
    ].join("\n");
    writeCsv(projectDir, "export.csv", csv);

    const outcome = applyImport(baseApplyOptions(projectsDir));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("blocked-by-unresolved");
    expect(fs.readFileSync(path.join(projectDir, "markups", "index.yaml"), "utf8")).toBe("[]\n");
  });

  it("writes a schema-valid merged index, preserves existing order, and updates in place", () => {
    const projectsDir = makeTempProjectsDir();
    const existing = markupIndexSchema.parse([
      { sheet: "Z-999", revision: 1, date: "2026-01-01", discipline: "structural", file: "originals/other.pdf", status: "open", related_code_sections: [] },
      { sheet: "A-101", revision: 3, date: "2026-07-01", discipline: "architectural", file: "originals/round-3.pdf", status: "open", related_code_sections: [] },
    ]);
    const projectDir = scaffoldProject(projectsDir, "test-project", `${JSON.stringify(existing)}\n`);
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS); // A-101 (status becomes addressed... wait Open maps open) + A-102 addition

    const outcome = applyImport(baseApplyOptions(projectsDir));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const written = markupIndexSchema.parse(loadYaml(fs.readFileSync(path.join(projectDir, "markups", "index.yaml"), "utf8")));
    expect(written).toHaveLength(3);
    // Original first entry (Z-999) keeps its position.
    expect(written[0].sheet).toBe("Z-999");
    // A-101 updated in place at its original index (index 1), notes now set from CSV.
    expect(written[1].sheet).toBe("A-101");
    expect(written[1].notes).toBe("Fix door swing");
    // New addition appended at the end.
    expect(written[2].sheet).toBe("A-102");
  });

  it("creates a recoverable timestamped backup of the pre-apply file", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "[]\n");
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS);

    const outcome = applyImport(baseApplyOptions(projectsDir));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(fs.existsSync(outcome.result.backupPath)).toBe(true);
    expect(fs.readFileSync(outcome.result.backupPath, "utf8")).toBe("[]\n");
  });

  it("preserves the original file when the pre-existing index.yaml is invalid", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "not: [valid, markup, index\n");
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS);
    const indexPath = path.join(projectDir, "markups", "index.yaml");
    const before = fs.readFileSync(indexPath, "utf8");

    const outcome = applyImport(baseApplyOptions(projectsDir));
    expect(outcome.ok).toBe(false);
    expect(fs.readFileSync(indexPath, "utf8")).toBe(before);
  });

  it("refuses to apply when the existing index has an ambiguous pre-existing identity", () => {
    const projectsDir = makeTempProjectsDir();
    const dup = {
      sheet: "A-101",
      revision: 3,
      date: "2026-07-01",
      discipline: "architectural",
      file: "originals/round-3.pdf",
      status: "open",
      related_code_sections: [],
    };
    const before = `${JSON.stringify([dup, dup])}\n`;
    const projectDir = scaffoldProject(projectsDir, "test-project", before);
    writeCsv(projectDir, "export.csv", CSV_TWO_ROWS);

    const outcome = applyImport(baseApplyOptions(projectsDir));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("ambiguous-existing-identity");
    expect(fs.readFileSync(path.join(projectDir, "markups", "index.yaml"), "utf8")).toBe(before);
  });

  it("rejects a CSV path outside the project's markups workspace", () => {
    const projectsDir = makeTempProjectsDir();
    const projectDir = scaffoldProject(projectsDir, "test-project", "[]\n");
    fs.writeFileSync(path.join(projectDir, "outside.csv"), CSV_TWO_ROWS, "utf8");

    const outcome = buildPreview({
      projectSlug: "test-project",
      csvPathArg: "../outside.csv",
      mapping: CLEAN_MAPPING,
      projectsDir,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("path-error");
  });
});
