import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigration, markSourceMigrated, previewMigration } from "./contentMigration";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-migration-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("previewMigration", () => {
  it("classifies new, identical, and conflicting files correctly", () => {
    const root = temporaryRoot();
    const source = path.join(root, "source");
    const dest = path.join(root, "dest");
    fs.mkdirSync(path.join(source, "schedule"), { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(source, "details.yaml"), "name: Demo\n", "utf8");
    fs.writeFileSync(path.join(source, "schedule", "schedule.yaml"), "milestones: []\n", "utf8");
    // Already present and identical at the destination.
    fs.writeFileSync(path.join(dest, "details.yaml"), "name: Demo\n", "utf8");
    // Present at destination but different -- needs review.
    fs.mkdirSync(path.join(dest, "schedule"), { recursive: true });
    fs.writeFileSync(path.join(dest, "schedule", "schedule.yaml"), "milestones: [conflicting]\n", "utf8");

    const preview = previewMigration(source, dest);
    const byPath = Object.fromEntries(preview.entries.map((entry) => [entry.relativePath, entry.status]));
    expect(byPath["details.yaml"]).toBe("identical");
    expect(byPath["schedule/schedule.yaml"]).toBe("needs-review");
  });

  it("reports a brand-new file as will-copy", () => {
    const root = temporaryRoot();
    const source = path.join(root, "source");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "notes.md"), "# Notes\n", "utf8");

    const preview = previewMigration(source, path.join(root, "dest"));
    expect(preview.entries).toEqual([
      expect.objectContaining({ relativePath: "notes.md", status: "will-copy", destHash: null }),
    ]);
  });

  it("never includes project.yaml -- it's the per-machine scaffold and must stay local", () => {
    const root = temporaryRoot();
    const source = path.join(root, "source");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "project.yaml"), "name: Demo\ndropbox_path: \"1.00 PROJECTS/Demo\"\n", "utf8");
    fs.writeFileSync(path.join(source, "details.yaml"), "name: Demo\n", "utf8");

    const preview = previewMigration(source, path.join(root, "dest"));
    expect(preview.entries.map((entry) => entry.relativePath)).toEqual(["details.yaml"]);
  });

  it("never re-includes its own retention marker on a later preview", () => {
    const root = temporaryRoot();
    const source = path.join(root, "source");
    fs.mkdirSync(source, { recursive: true });
    markSourceMigrated(source, "2026-07-26T12:00:00.000Z");

    const preview = previewMigration(source, path.join(root, "dest"));
    expect(preview.entries).toEqual([]);
  });

  it("ignores non-migratable extensions and dotfiles/backup directories", () => {
    const root = temporaryRoot();
    const source = path.join(root, "source");
    fs.mkdirSync(path.join(source, ".mi-backups"), { recursive: true });
    fs.writeFileSync(path.join(source, "drawing.pdf"), "%PDF-1.4\n", "utf8");
    fs.writeFileSync(path.join(source, ".mi-backups", "old.yaml"), "stale: true\n", "utf8");

    const preview = previewMigration(source, path.join(root, "dest"));
    expect(preview.entries).toEqual([]);
  });
});

describe("applyMigration", () => {
  it("refuses to run without explicit confirmation", () => {
    const root = temporaryRoot();
    const preview = previewMigration(path.join(root, "source"), path.join(root, "dest"));
    expect(() => applyMigration(preview, { confirmed: false })).toThrow(/confirmation/);
  });

  it("copies will-copy entries, skips identical ones, and never touches the source", () => {
    const root = temporaryRoot();
    const source = path.join(root, "source");
    const dest = path.join(root, "dest");
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(source, "details.yaml"), "name: Demo\n", "utf8");
    fs.writeFileSync(path.join(dest, "existing.yaml"), "already: here\n", "utf8");
    fs.writeFileSync(path.join(source, "existing.yaml"), "already: here\n", "utf8");

    const preview = previewMigration(source, dest);
    const results = applyMigration(preview, { confirmed: true });

    expect(results).toEqual(expect.arrayContaining([
      { relativePath: "details.yaml", status: "copied" },
      { relativePath: "existing.yaml", status: "skipped" },
    ]));
    expect(fs.readFileSync(path.join(dest, "details.yaml"), "utf8")).toBe("name: Demo\n");
    // Source is never modified or deleted.
    expect(fs.readFileSync(path.join(source, "details.yaml"), "utf8")).toBe("name: Demo\n");
  });

  it("skips a needs-review entry unless explicitly included", () => {
    const root = temporaryRoot();
    const source = path.join(root, "source");
    const dest = path.join(root, "dest");
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(source, "details.yaml"), "name: New\n", "utf8");
    fs.writeFileSync(path.join(dest, "details.yaml"), "name: Old\n", "utf8");

    const preview = previewMigration(source, dest);
    const skipped = applyMigration(preview, { confirmed: true });
    expect(skipped).toEqual([{ relativePath: "details.yaml", status: "skipped", error: expect.any(String) }]);
    expect(fs.readFileSync(path.join(dest, "details.yaml"), "utf8")).toBe("name: Old\n");

    const included = applyMigration(preview, { confirmed: true, includeRelativePaths: ["details.yaml"] });
    expect(included).toEqual([{ relativePath: "details.yaml", status: "copied" }]);
    expect(fs.readFileSync(path.join(dest, "details.yaml"), "utf8")).toBe("name: New\n");
  });

  it("is idempotent -- re-running after a full migration reports everything identical", () => {
    const root = temporaryRoot();
    const source = path.join(root, "source");
    const dest = path.join(root, "dest");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "details.yaml"), "name: Demo\n", "utf8");

    applyMigration(previewMigration(source, dest), { confirmed: true });
    const second = previewMigration(source, dest);
    expect(second.entries).toEqual([
      expect.objectContaining({ relativePath: "details.yaml", status: "identical" }),
    ]);
  });
});

describe("markSourceMigrated", () => {
  it("drops a retention marker without deleting anything in the source directory", () => {
    const root = temporaryRoot();
    const source = path.join(root, "source");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "details.yaml"), "name: Demo\n", "utf8");

    markSourceMigrated(source, "2026-07-26T12:00:00.000Z");

    expect(fs.readFileSync(path.join(source, "details.yaml"), "utf8")).toBe("name: Demo\n");
    expect(fs.readFileSync(path.join(source, "MIGRATED-TO-DROPBOX.md"), "utf8")).toContain("2026-07-26T12:00:00.000Z");
  });
});
