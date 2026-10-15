import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  previewPersonalDataMigration,
  applyPersonalDataMigration,
  markPersonalDataMigrated,
} = require("./personalDataMigration.js") as {
  previewPersonalDataMigration(options: { sourceDir: string; destDir: string }): {
    sourceDir: string; destDir: string; status: string; sourceHash: string | null; destHash: string | null;
  };
  applyPersonalDataMigration(
    preview: { sourceDir: string; destDir: string; status: string },
    options?: { confirmOverwrite?: boolean },
  ): { copied: boolean; status: string; error?: string };
  markPersonalDataMigrated(sourceDir: string, destDir: string, migratedAtIso: string): void;
};

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-personal-migration-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("personal data migration", () => {
  it("reports nothing-to-copy on a fresh install with no records.json yet", () => {
    const root = temporaryRoot();
    const sourceDir = path.join(root, "old");
    const destDir = path.join(root, "new");
    fs.mkdirSync(sourceDir, { recursive: true });

    const preview = previewPersonalDataMigration({ sourceDir, destDir });
    expect(preview.status).toBe("nothing-to-copy");
    expect(applyPersonalDataMigration(preview)).toEqual({ copied: false, status: "nothing-to-copy" });
  });

  it("copies records.json to a destination that doesn't have one yet", () => {
    const root = temporaryRoot();
    const sourceDir = path.join(root, "old");
    const destDir = path.join(root, "new");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "records.json"), '{"records":[]}', "utf8");

    const preview = previewPersonalDataMigration({ sourceDir, destDir });
    expect(preview.status).toBe("will-copy");
    const result = applyPersonalDataMigration(preview);
    expect(result).toEqual({ copied: true, status: "copied" });
    expect(fs.readFileSync(path.join(destDir, "records.json"), "utf8")).toBe('{"records":[]}');
    // Source is never touched.
    expect(fs.readFileSync(path.join(sourceDir, "records.json"), "utf8")).toBe('{"records":[]}');
  });

  it("does nothing when the destination already has identical content", () => {
    const root = temporaryRoot();
    const sourceDir = path.join(root, "old");
    const destDir = path.join(root, "new");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "records.json"), '{"records":[]}', "utf8");
    fs.writeFileSync(path.join(destDir, "records.json"), '{"records":[]}', "utf8");

    const preview = previewPersonalDataMigration({ sourceDir, destDir });
    expect(preview.status).toBe("identical");
    expect(applyPersonalDataMigration(preview)).toEqual({ copied: false, status: "identical" });
  });

  it("refuses to overwrite a different destination without explicit confirmation", () => {
    const root = temporaryRoot();
    const sourceDir = path.join(root, "old");
    const destDir = path.join(root, "new");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "records.json"), '{"records":["new"]}', "utf8");
    fs.writeFileSync(path.join(destDir, "records.json"), '{"records":["old"]}', "utf8");

    const preview = previewPersonalDataMigration({ sourceDir, destDir });
    expect(preview.status).toBe("needs-review");
    const refused = applyPersonalDataMigration(preview);
    expect(refused.copied).toBe(false);
    expect(refused.status).toBe("needs-review");
    expect(fs.readFileSync(path.join(destDir, "records.json"), "utf8")).toBe('{"records":["old"]}');

    const confirmed = applyPersonalDataMigration(preview, { confirmOverwrite: true });
    expect(confirmed).toEqual({ copied: true, status: "copied" });
    expect(fs.readFileSync(path.join(destDir, "records.json"), "utf8")).toBe('{"records":["new"]}');
  });

  it("marks the source directory with a retention marker without deleting anything", () => {
    const root = temporaryRoot();
    const sourceDir = path.join(root, "old");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "records.json"), '{"records":[]}', "utf8");

    markPersonalDataMigrated(sourceDir, path.join(root, "new"), "2026-07-31T12:00:00.000Z");

    expect(fs.readFileSync(path.join(sourceDir, "records.json"), "utf8")).toBe('{"records":[]}');
    const marker = fs.readFileSync(path.join(sourceDir, "MOVED.md"), "utf8");
    expect(marker).toContain("2026-07-31T12:00:00.000Z");
    expect(marker).toContain(path.join(root, "new"));
  });

  it("does not mark the source when it never had personal data", () => {
    const root = temporaryRoot();
    const sourceDir = path.join(root, "old");
    fs.mkdirSync(sourceDir, { recursive: true });

    markPersonalDataMigrated(sourceDir, path.join(root, "new"), "2026-07-31T12:00:00.000Z");

    expect(fs.existsSync(path.join(sourceDir, "MOVED.md"))).toBe(false);
  });
});
