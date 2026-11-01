import fs from "node:fs";
import path from "node:path";
import { getLead } from "./leads";
import { DROPBOX_ROOT } from "./paths";
import { getPermitQaqcEngagement } from "./permitQaqc";
import { getProject } from "./projects";
import type { WorkspaceKind } from "./workspaceOutbox";

/** The notes file a reviewer's "Choose folder" destination appends to. */
export const REVIEW_FOLDER_FILE = "Mi Review Notes.md";

/** The workspace's human-confirmed folder. Never inferred, and null rather than a guess. */
export function workspaceDropboxPath(kind: WorkspaceKind, slug: string): string | null {
  try {
    const relative = kind === "project"
      ? getProject(slug).meta.dropbox_path
      : kind === "lead"
        ? getLead(slug).lead.dropbox_path
        : getPermitQaqcEngagement(slug).engagement.dropbox_path;
    return relative?.replaceAll("\\", "/") || null;
  } catch {
    return null;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolves a reviewer's folder choice, relative to the workspace's confirmed folder.
 *
 * Real paths are compared so a junction inside the project cannot walk a note out of it. The
 * folder must already exist: a typo in the browser fallback must not create a stray tree.
 */
export function resolveReviewFolder(
  workspaceFolder: string,
  folder: string,
  dropboxRoot: string | null | undefined = DROPBOX_ROOT,
): { file: string; relative: string } {
  if (!dropboxRoot) throw new Error("Dropbox is not configured on this machine.");
  const relative = folder.replaceAll("\\", "/").replace(/^\.\/?$/, "").replace(/\/+$/, "");
  if (path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative) || relative.split("/").includes("..")) {
    throw new Error("Choose a folder inside this project's linked Dropbox folder.");
  }
  const root = path.join(dropboxRoot, workspaceFolder);
  const target = path.join(root, relative);
  if (!fs.existsSync(root) || !fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error("That folder does not exist. Choose an existing folder.");
  }
  if (!isInside(fs.realpathSync(root), fs.realpathSync(target))) {
    throw new Error("Choose a folder inside this project's linked Dropbox folder.");
  }
  return { file: path.join(target, REVIEW_FOLDER_FILE), relative: relative || "." };
}
