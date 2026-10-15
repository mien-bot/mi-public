import fs from "node:fs";
import path from "node:path";
import {
  assertNoSymlinkOrReparsePoint,
  isPathInside,
  normalizeSafeRelativePath,
} from "./leadLibraryPathSafety";

export const RECOMMENDED_LIBRARY_FOLDERS = [
  "00_Inbox-To-Review",
  "01_Marketing",
  "01_Marketing/Brand",
  "01_Marketing/Portfolio",
  "01_Marketing/Photography",
  "01_Marketing/Templates",
  "01_Marketing/Awards-Press",
  "02_Reference-Projects",
  "02_Reference-Projects/By-Building-Type",
  "02_Reference-Projects/By-Firm-Or-Source",
  "02_Reference-Projects/Details-Materials",
  "02_Reference-Projects/Plans-Sections",
  "03_Firm-Standards",
  "99_Archive",
] as const;

export type DropboxFolderPreviewStatus = "create" | "exists" | "conflict";
export interface DropboxFolderPreview {
  folder: string;
  dropboxRelativePath: string;
  status: DropboxFolderPreviewStatus;
  message: string;
}

export interface DropboxLibraryPreview {
  parentPath: string;
  folders: DropboxFolderPreview[];
  canApply: boolean;
}

export interface DropboxFolderApplyResult {
  folder: string;
  dropboxRelativePath: string;
  status: "created" | "exists" | "conflict" | "error";
  message: string;
}

function resolveParent(dropboxRoot: string, parentInput: unknown): {
  normalizedParent: string;
  realRoot: string;
  realParent: string;
} {
  if (!dropboxRoot) throw new Error("DROPBOX_ROOT is not configured on this machine.");
  if (!fs.existsSync(dropboxRoot) || !fs.statSync(dropboxRoot).isDirectory()) {
    throw new Error("DROPBOX_ROOT is unavailable on this machine.");
  }
  const realRoot = fs.realpathSync(dropboxRoot);
  const normalizedParent = normalizeSafeRelativePath(parentInput, "Library parent path");
  assertNoSymlinkOrReparsePoint(dropboxRoot, normalizedParent);
  const parent = path.resolve(dropboxRoot, ...normalizedParent.split("/"));
  if (!isPathInside(dropboxRoot, parent) || !fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error("The confirmed library parent must be an existing folder beneath DROPBOX_ROOT.");
  }
  const realParent = fs.realpathSync(parent);
  if (!isPathInside(realRoot, realParent)) {
    throw new Error("The confirmed library parent escapes DROPBOX_ROOT.");
  }
  return { normalizedParent, realRoot, realParent };
}

function normalizeFolderPlan(foldersInput: unknown): string[] {
  if (!Array.isArray(foldersInput) || foldersInput.length === 0) {
    throw new Error("Add at least one relative folder to the plan.");
  }
  const folders = foldersInput.map((folder) => normalizeSafeRelativePath(folder, "Planned folder"));
  const unique = new Set<string>();
  for (const folder of folders) {
    const key = folder.toLowerCase();
    if (unique.has(key)) throw new Error(`Planned folder "${folder}" is duplicated.`);
    unique.add(key);
  }
  return folders;
}

export function previewDropboxLibraryPlan(
  dropboxRoot: string,
  parentInput: unknown,
  foldersInput: unknown,
): DropboxLibraryPreview {
  const { normalizedParent, realParent } = resolveParent(dropboxRoot, parentInput);
  const folders = normalizeFolderPlan(foldersInput);
  const planned = new Set(folders.map((folder) => folder.toLowerCase()));

  const preview = folders.map<DropboxFolderPreview>((folder) => {
    assertNoSymlinkOrReparsePoint(realParent, folder);
    const target = path.resolve(realParent, ...folder.split("/"));
    const dropboxRelativePath = `${normalizedParent}/${folder}`;
    if (!isPathInside(realParent, target)) {
      return { folder, dropboxRelativePath, status: "conflict", message: "Path escapes the confirmed parent." };
    }
    if (fs.existsSync(target)) {
      return fs.statSync(target).isDirectory()
        ? { folder, dropboxRelativePath, status: "exists", message: "Folder already exists; it will be left unchanged." }
        : { folder, dropboxRelativePath, status: "conflict", message: "A file already occupies this path." };
    }
    const parentFolder = path.posix.dirname(folder);
    if (parentFolder !== "." && !fs.existsSync(path.resolve(realParent, ...parentFolder.split("/"))) &&
        !planned.has(parentFolder.toLowerCase())) {
      return {
        folder,
        dropboxRelativePath,
        status: "conflict",
        message: `Parent folder "${parentFolder}" is neither existing nor included in this plan.`,
      };
    }
    return { folder, dropboxRelativePath, status: "create", message: "Folder will be created." };
  });
  return {
    parentPath: normalizedParent,
    folders: preview,
    canApply: preview.every((item) => item.status !== "conflict"),
  };
}

export function applyDropboxLibraryPlan(
  dropboxRoot: string,
  parentInput: unknown,
  foldersInput: unknown,
  confirmed: unknown,
): { parentPath: string; results: DropboxFolderApplyResult[] } {
  if (confirmed !== true) throw new Error("Explicit confirmation is required.");
  const preview = previewDropboxLibraryPlan(dropboxRoot, parentInput, foldersInput);
  if (!preview.canApply) throw new Error("Resolve every preview conflict before applying the folder plan.");
  const { realParent } = resolveParent(dropboxRoot, parentInput);
  const results: DropboxFolderApplyResult[] = [];

  for (const item of preview.folders) {
    const target = path.resolve(realParent, ...item.folder.split("/"));
    try {
      assertNoSymlinkOrReparsePoint(realParent, item.folder);
      if (!isPathInside(realParent, target)) throw new Error("Path escapes the confirmed parent.");
      if (fs.existsSync(target)) {
        results.push(fs.statSync(target).isDirectory()
          ? { ...item, status: "exists", message: "Folder already exists; left unchanged." }
          : { ...item, status: "conflict", message: "A file occupies this path; left unchanged." });
        continue;
      }
      const parent = path.dirname(target);
      if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
        results.push({ ...item, status: "conflict", message: "Parent folder is unavailable; left unchanged." });
        continue;
      }
      fs.mkdirSync(target);
      results.push({ ...item, status: "created", message: "Created." });
    } catch (cause) {
      results.push({
        ...item,
        status: "error",
        message: cause instanceof Error ? cause.message : "Folder creation failed.",
      });
    }
  }
  return { parentPath: preview.parentPath, results };
}
