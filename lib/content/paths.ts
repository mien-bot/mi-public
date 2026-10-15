import fs from "node:fs";
import path from "node:path";
import { scanForConflicts, type ConflictedFile } from "./dropboxConflicts";

/**
 * Development reads the checkout. A packaged build receives an isolated
 * per-user data root from Electron and never treats installed application
 * files as writable content.
 */
export const REPO_ROOT = path.resolve(process.env.MI_CONTENT_ROOT || process.cwd());
export const PROJECTS_DIR = path.join(REPO_ROOT, "projects");
export const CODES_DIR = path.join(REPO_ROOT, "codes");
export const REFERENCE_DIR = path.join(REPO_ROOT, "reference");
export const LIBRARY_DIR = path.join(REPO_ROOT, "library");
/** Per-user local fallback -- see resolveFirmDataDir for the Dropbox-shared path. */
export const CLIENTS_DIR = path.join(REPO_ROOT, "clients");
/** Per-user local fallback -- see resolveFirmDataDir for the Dropbox-shared path. */
export const LEADS_DIR = path.join(REPO_ROOT, "leads");
/** Per-user local fallback -- see resolveFirmDataDir for the Dropbox-shared path. */
export const PERMIT_QAQC_DIR = path.join(REPO_ROOT, "permit-qaqc");

/**
 * Per-machine Dropbox sync root (e.g. "E:\Dropbox\STUDIO" on this machine — a
 * different person's Dropbox client syncs the same shared folder to a
 * different local path on theirs). Set in .env.local, which is gitignored —
 * never hardcode a path here. A project links to its Dropbox folder via
 * `dropbox_path` in project.yaml (a path relative to this root), not by
 * copying files into the repo.
 */
export const DROPBOX_ROOT = process.env.DROPBOX_ROOT || null;

/**
 * Relative to DROPBOX_ROOT, like a project's dropbox_path. The Electron main process
 * (electron/desktopMain.js) only sets this env var once the firm-wide clients/leads
 * migration has actually been confirmed (electron/configStore.js's
 * dropboxFirmDataMigrated) -- so its mere presence here already implies "migrated",
 * matching content_location's two-flag gate for per-project data (see
 * lib/content/projectContentRoot.ts).
 */
const DROPBOX_FIRM_DATA_PATH = process.env.DROPBOX_FIRM_DATA_PATH || null;

export interface FirmDataDir {
  dir: string;
  shared: boolean;
}

/**
 * Thrown when the firm-wide data has been migrated to Dropbox but the shared folder isn't
 * reachable right now. Mirrors ContentRootUnavailableError (lib/content/projectContentRoot.ts)
 * -- kept as a separate class here (rather than imported) so this low-level, dependency-free
 * paths module doesn't import back from a module that already depends on it.
 */
export class FirmDataUnavailableError extends Error {
  kind: "clients" | "leads" | "permit-qaqc";

  constructor(kind: "clients" | "leads" | "permit-qaqc") {
    super(`Firm-wide ${kind} data isn't reachable right now (check that Dropbox is running and has finished syncing).`);
    this.name = "FirmDataUnavailableError";
    this.kind = kind;
  }
}

const LOCAL_FALLBACK_DIR: Record<"clients" | "leads" | "permit-qaqc", string> = {
  clients: CLIENTS_DIR,
  leads: LEADS_DIR,
  "permit-qaqc": PERMIT_QAQC_DIR,
};

/**
 * Kinds with no pre-existing local data to protect. clients/leads only ever reach the
 * shared root through the explicit migration flow (electron/firmDataMigration.js), which
 * creates their subfolder as part of migrating real records -- resolveFirmDataDir must
 * never silently create an empty clients/ or leads/ folder there, since that could mask a
 * real migration that just hasn't run yet (or a sync problem) as "zero clients/leads"
 * instead of failing loudly. permit-qaqc has no such history: nothing was ever migrated
 * into it, so there's no fork risk in creating its subfolder the first time it's needed.
 */
const AUTO_CREATE_KINDS = new Set<"clients" | "leads" | "permit-qaqc">(["permit-qaqc"]);

/**
 * Resolves the firm-wide clients/leads/permit-qaqc directory. Only falls back to the
 * per-user local constant (CLIENTS_DIR/LEADS_DIR/PERMIT_QAQC_DIR) when the shared path was
 * never configured/migrated in the first place (DROPBOX_FIRM_DATA_PATH unset -- the
 * "no-op by default" case). Once migrated, an unreachable shared folder fails closed
 * (FirmDataUnavailableError) instead of silently falling back, for the same "never fork
 * the data" reason as ContentRootUnavailableError -- except for AUTO_CREATE_KINDS (see
 * above), where the shared root being reachable is enough to create the subfolder itself.
 */
export function resolveFirmDataDir(kind: "clients" | "leads" | "permit-qaqc"): FirmDataDir {
  if (DROPBOX_FIRM_DATA_PATH) {
    if (!DROPBOX_ROOT) throw new FirmDataUnavailableError(kind);
    const sharedRoot = path.join(DROPBOX_ROOT, DROPBOX_FIRM_DATA_PATH);
    const dir = path.join(sharedRoot, kind);
    if (!fs.existsSync(dir)) {
      if (AUTO_CREATE_KINDS.has(kind) && fs.existsSync(sharedRoot)) {
        fs.mkdirSync(dir, { recursive: true });
      } else {
        throw new FirmDataUnavailableError(kind);
      }
    }
    return { dir, shared: true };
  }
  return { dir: LOCAL_FALLBACK_DIR[kind], shared: false };
}

/** Scans every firm-wide directory for Dropbox conflicted-copy files; see detectProjectConflicts. */
export function detectFirmDataConflicts(): { clients: ConflictedFile[]; leads: ConflictedFile[]; permitQaqc: ConflictedFile[] } {
  function scan(kind: "clients" | "leads" | "permit-qaqc"): ConflictedFile[] {
    try {
      return scanForConflicts(resolveFirmDataDir(kind).dir);
    } catch {
      return [];
    }
  }
  return { clients: scan("clients"), leads: scan("leads"), permitQaqc: scan("permit-qaqc") };
}
