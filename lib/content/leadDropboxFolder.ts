import fs from "node:fs";
import path from "node:path";
import {
  assertNoSymlinkOrReparsePoint,
  isPathInside,
  normalizeSafeRelativePath,
} from "./leadLibraryPathSafety";

export const LEAD_DROPBOX_SUBFOLDERS = [
  "contracts",
  "owner-supplied",
  "site-photos",
  "correspondence",
  "Mi",
] as const;

export type LeadDropboxAction = "create" | "link-existing";

export interface LeadDropboxPlan {
  action: LeadDropboxAction;
  relativePath: string;
  folders: string[];
  behavior: string;
  /** Recovery-only: fill missing standard subfolders beneath an already-confirmed root. */
  allowExistingRoot?: boolean;
}

function resolvedDropboxTarget(dropboxRoot: string, relativePath: unknown): {
  normalized: string;
  realRoot: string;
  target: string;
} {
  if (!dropboxRoot || !fs.existsSync(dropboxRoot) || !fs.statSync(dropboxRoot).isDirectory()) {
    throw new Error("Choose a reachable local Dropbox root in Settings first.");
  }
  const normalized = normalizeSafeRelativePath(relativePath, "Dropbox folder");
  const realRoot = fs.realpathSync(dropboxRoot);
  assertNoSymlinkOrReparsePoint(realRoot, normalized);
  const target = path.resolve(realRoot, ...normalized.split("/"));
  if (!isPathInside(realRoot, target)) throw new Error("Dropbox folder escapes the configured root.");
  return { normalized, realRoot, target };
}

/** Side-effect-free validation used before a lead record stores the exact human choice. */
export function previewLeadDropboxFolder(
  dropboxRoot: string,
  relativePath: unknown,
  action: LeadDropboxAction,
  options: { allowExistingRoot?: boolean } = {},
): LeadDropboxPlan {
  const { normalized, realRoot, target } = resolvedDropboxTarget(dropboxRoot, relativePath);
  const exists = fs.existsSync(target);
  if (action === "create" && exists && !fs.statSync(target).isDirectory()) {
    throw new Error(`Dropbox path is not a folder: ${normalized}.`);
  }
  if (action === "create" && exists && !options.allowExistingRoot) {
    throw new Error(`Dropbox folder already exists: ${normalized}. Choose “link existing” instead.`);
  }
  if (action === "link-existing") {
    if (!exists || !fs.statSync(target).isDirectory()) {
      throw new Error(`The selected Dropbox folder does not exist: ${normalized}.`);
    }
    const realTarget = fs.realpathSync(target);
    if (!isPathInside(realRoot, realTarget)) {
      throw new Error("The selected Dropbox folder resolves outside the configured root.");
    }
  }
  return {
    action,
    relativePath: normalized,
    folders: action === "create" ? [...LEAD_DROPBOX_SUBFOLDERS] : [],
    behavior: action === "create"
      ? "Creates the lead folder and standard subfolders after confirmation."
      : "Links the existing folder only; no Dropbox content is changed.",
    ...(options.allowExistingRoot ? { allowExistingRoot: true } : {}),
  };
}

/** Applies only an exact reviewed create plan. Existing content is never overwritten. */
export function applyLeadDropboxFolder(
  dropboxRoot: string,
  plan: LeadDropboxPlan,
  confirmed: boolean,
): { createdFolders: string[] } {
  if (!confirmed) throw new Error("Explicit confirmation is required before creating Dropbox folders.");
  if (plan.action !== "create") return { createdFolders: [] };
  const reviewed = previewLeadDropboxFolder(
    dropboxRoot,
    plan.relativePath,
    "create",
    { allowExistingRoot: plan.allowExistingRoot },
  );
  if (JSON.stringify(reviewed) !== JSON.stringify(plan)) {
    throw new Error("The confirmed Dropbox plan differs from its preview. Review it again.");
  }
  const { target } = resolvedDropboxTarget(dropboxRoot, plan.relativePath);
  const createdFolders: string[] = [];
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
    createdFolders.push(".");
  }
  for (const folder of plan.folders) {
    const child = path.join(target, folder);
    if (!fs.existsSync(child)) {
      fs.mkdirSync(child, { recursive: false });
      createdFolders.push(folder);
    }
  }
  return { createdFolders };
}
