import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-firm-data-"));
  roots.push(root);
  return root;
}

const originalEnv = {
  DROPBOX_ROOT: process.env.DROPBOX_ROOT,
  DROPBOX_FIRM_DATA_PATH: process.env.DROPBOX_FIRM_DATA_PATH,
  MI_CONTENT_ROOT: process.env.MI_CONTENT_ROOT,
};

async function loadPaths() {
  vi.resetModules();
  return import("./paths");
}

beforeEach(() => {
  process.env.MI_CONTENT_ROOT = temporaryRoot();
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  process.env.DROPBOX_ROOT = originalEnv.DROPBOX_ROOT;
  process.env.DROPBOX_FIRM_DATA_PATH = originalEnv.DROPBOX_FIRM_DATA_PATH;
  process.env.MI_CONTENT_ROOT = originalEnv.MI_CONTENT_ROOT;
});

describe("resolveFirmDataDir", () => {
  it("falls back to the per-user local constants when unconfigured (today's default)", async () => {
    delete process.env.DROPBOX_ROOT;
    delete process.env.DROPBOX_FIRM_DATA_PATH;
    const { resolveFirmDataDir, CLIENTS_DIR, LEADS_DIR, PERMIT_QAQC_DIR } = await loadPaths();
    expect(resolveFirmDataDir("clients")).toEqual({ dir: CLIENTS_DIR, shared: false });
    expect(resolveFirmDataDir("leads")).toEqual({ dir: LEADS_DIR, shared: false });
    expect(resolveFirmDataDir("permit-qaqc")).toEqual({ dir: PERMIT_QAQC_DIR, shared: false });
  });

  it("resolves to the shared Dropbox folder once configured and reachable", async () => {
    const dropboxRoot = temporaryRoot();
    fs.mkdirSync(path.join(dropboxRoot, "Mi Data", "clients"), { recursive: true });
    fs.mkdirSync(path.join(dropboxRoot, "Mi Data", "leads"), { recursive: true });
    process.env.DROPBOX_ROOT = dropboxRoot;
    process.env.DROPBOX_FIRM_DATA_PATH = "Mi Data";

    const { resolveFirmDataDir } = await loadPaths();
    expect(resolveFirmDataDir("clients")).toEqual({
      dir: path.join(dropboxRoot, "Mi Data", "clients"), shared: true,
    });
    expect(resolveFirmDataDir("leads")).toEqual({
      dir: path.join(dropboxRoot, "Mi Data", "leads"), shared: true,
    });
  });

  it("fails closed (never falls back to local) when configured but unreachable", async () => {
    const dropboxRoot = temporaryRoot();
    process.env.DROPBOX_ROOT = dropboxRoot;
    process.env.DROPBOX_FIRM_DATA_PATH = "Mi Data";

    const { resolveFirmDataDir, FirmDataUnavailableError } = await loadPaths();
    expect(() => resolveFirmDataDir("clients")).toThrow(FirmDataUnavailableError);
  });

  it("auto-creates the permit-qaqc subfolder the first time it's needed, unlike clients/leads", async () => {
    const dropboxRoot = temporaryRoot();
    fs.mkdirSync(path.join(dropboxRoot, "Mi Data"), { recursive: true });
    process.env.DROPBOX_ROOT = dropboxRoot;
    process.env.DROPBOX_FIRM_DATA_PATH = "Mi Data";

    const { resolveFirmDataDir, FirmDataUnavailableError } = await loadPaths();
    // clients/leads still fail closed -- their subfolder only ever appears via migration.
    expect(() => resolveFirmDataDir("clients")).toThrow(FirmDataUnavailableError);

    const expectedDir = path.join(dropboxRoot, "Mi Data", "permit-qaqc");
    expect(fs.existsSync(expectedDir)).toBe(false);
    expect(resolveFirmDataDir("permit-qaqc")).toEqual({ dir: expectedDir, shared: true });
    expect(fs.existsSync(expectedDir)).toBe(true);
    // idempotent on a second call now that it exists.
    expect(resolveFirmDataDir("permit-qaqc")).toEqual({ dir: expectedDir, shared: true });
  });

  it("still fails closed for permit-qaqc when the shared root itself isn't reachable", async () => {
    const dropboxRoot = temporaryRoot();
    process.env.DROPBOX_ROOT = dropboxRoot;
    process.env.DROPBOX_FIRM_DATA_PATH = "Mi Data";

    const { resolveFirmDataDir, FirmDataUnavailableError } = await loadPaths();
    expect(() => resolveFirmDataDir("permit-qaqc")).toThrow(FirmDataUnavailableError);
  });
});
