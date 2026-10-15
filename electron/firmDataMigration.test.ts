import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { previewFirmDataMigration, applyFirmDataMigration, markSourceMigrated } = require("./firmDataMigration.js") as {
  previewFirmDataMigration(options: {
    clientsSourceDir: string; clientsDestDir: string; leadsSourceDir: string; leadsDestDir: string;
  }): { clients: { sourceDir: string; destDir: string; entries: unknown[] }; leads: { sourceDir: string; destDir: string; entries: unknown[] } };
  applyFirmDataMigration(options: { clientsPreview: unknown; leadsPreview: unknown; includeRelativePaths?: string[] }): {
    clients: { relativePath: string; status: string }[];
    leads: { relativePath: string; status: string }[];
    migrationComplete: boolean;
  };
  markSourceMigrated(sourceDir: string, migratedAtIso: string): void;
};

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-firm-migration-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("firm data migration", () => {
  it("previews and applies clients/leads together, reporting overall completion", () => {
    const root = temporaryRoot();
    const clientsSourceDir = path.join(root, "local", "clients");
    const leadsSourceDir = path.join(root, "local", "leads");
    const clientsDestDir = path.join(root, "shared", "clients");
    const leadsDestDir = path.join(root, "shared", "leads");
    fs.mkdirSync(clientsSourceDir, { recursive: true });
    fs.mkdirSync(leadsSourceDir, { recursive: true });
    fs.writeFileSync(path.join(clientsSourceDir, "acme.yaml"), "name: Acme\n", "utf8");
    fs.writeFileSync(path.join(leadsSourceDir, "prospect.yaml"), "name: Prospect\n", "utf8");

    const preview = previewFirmDataMigration({ clientsSourceDir, clientsDestDir, leadsSourceDir, leadsDestDir });
    expect(preview.clients.entries).toEqual([
      expect.objectContaining({ relativePath: "acme.yaml", status: "will-copy" }),
    ]);
    expect(preview.leads.entries).toEqual([
      expect.objectContaining({ relativePath: "prospect.yaml", status: "will-copy" }),
    ]);

    const result = applyFirmDataMigration({ clientsPreview: preview.clients, leadsPreview: preview.leads });
    expect(result.migrationComplete).toBe(true);
    expect(fs.readFileSync(path.join(clientsDestDir, "acme.yaml"), "utf8")).toBe("name: Acme\n");
    expect(fs.readFileSync(path.join(leadsDestDir, "prospect.yaml"), "utf8")).toBe("name: Prospect\n");
    // Source is never touched.
    expect(fs.readFileSync(path.join(clientsSourceDir, "acme.yaml"), "utf8")).toBe("name: Acme\n");
  });

  it("reports migrationComplete: false when either side has an unresolved conflict", () => {
    const root = temporaryRoot();
    const clientsSourceDir = path.join(root, "local", "clients");
    const clientsDestDir = path.join(root, "shared", "clients");
    const leadsSourceDir = path.join(root, "local", "leads");
    const leadsDestDir = path.join(root, "shared", "leads");
    fs.mkdirSync(clientsSourceDir, { recursive: true });
    fs.mkdirSync(clientsDestDir, { recursive: true });
    fs.mkdirSync(leadsSourceDir, { recursive: true });
    fs.writeFileSync(path.join(clientsSourceDir, "acme.yaml"), "name: New\n", "utf8");
    fs.writeFileSync(path.join(clientsDestDir, "acme.yaml"), "name: Old\n", "utf8");

    const preview = previewFirmDataMigration({ clientsSourceDir, clientsDestDir, leadsSourceDir, leadsDestDir });
    const result = applyFirmDataMigration({ clientsPreview: preview.clients, leadsPreview: preview.leads });
    expect(result.migrationComplete).toBe(false);
    expect(fs.readFileSync(path.join(clientsDestDir, "acme.yaml"), "utf8")).toBe("name: Old\n");
  });

  it("marks the source directory with a retention marker without deleting anything", () => {
    const root = temporaryRoot();
    const sourceDir = path.join(root, "clients");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "acme.yaml"), "name: Acme\n", "utf8");

    markSourceMigrated(sourceDir, "2026-07-26T12:00:00.000Z");

    expect(fs.readFileSync(path.join(sourceDir, "acme.yaml"), "utf8")).toBe("name: Acme\n");
    expect(fs.readFileSync(path.join(sourceDir, "MIGRATED-TO-DROPBOX.md"), "utf8")).toContain("2026-07-26T12:00:00.000Z");
  });
});
