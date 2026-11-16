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

const RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/** A single folder name that is safe on Windows, macOS, and in Dropbox; never a path. */
export function validateNewFolderName(input: string): string {
  const name = input.trim();
  if (!name) throw new Error("Enter a folder name.");
  if (name.length > 100) throw new Error("Use a folder name of 100 characters or fewer.");
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) throw new Error("A folder name can’t contain \\ / : * ? \" < > |.");
  if (name === "." || name === ".." || /[. ]$/.test(name) || RESERVED_NAMES.test(name)) {
    throw new Error("Windows can’t use that folder name. Try another.");
  }
  return name;
}

/**
 * Creates one folder, chosen by the reviewer, inside an existing folder of the workspace's
 * confirmed Dropbox folder. An existing folder of that name is reused rather than an error.
 */
export function createReviewFolder(
  workspaceFolder: string,
  parent: string,
  name: string,
  dropboxRoot: string | null | undefined = DROPBOX_ROOT,
): { relative: string; created: boolean } {
  const folderName = validateNewFolderName(name);
  const parentTarget = resolveReviewFolder(workspaceFolder, parent, dropboxRoot);
  const target = path.join(path.dirname(parentTarget.file), folderName);
  const relative = parentTarget.relative === "." ? folderName : `${parentTarget.relative}/${folderName}`;
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isDirectory()) throw new Error("A file with that name is already there. Choose another name.");
    return { relative, created: false };
  }
  fs.mkdirSync(target);
  return { relative, created: true };
}
