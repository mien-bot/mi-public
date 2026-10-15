import fs from "node:fs";
import path from "node:path";
import { DROPBOX_ROOT } from "./paths";
import type { Lead, PermitQaqcEngagement, ProjectMeta } from "@/lib/schema";

export interface DropboxNode {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  children?: DropboxNode[];
}

/**
 * Resolves a project's real Dropbox folder from its `dropbox_path`, or null
 * if either the project has no `dropbox_path` set or DROPBOX_ROOT isn't
 * configured on this machine (e.g. a machine that only runs the app against
 * the git-tracked content, no local Dropbox client).
 */
export function getProjectDropboxDir(meta: ProjectMeta): string | null {
  if (!DROPBOX_ROOT || !meta.dropbox_path) return null;
  return path.join(DROPBOX_ROOT, meta.dropbox_path);
}

/** Same resolution as getProjectDropboxDir, for a lead's real Dropbox folder. */
export function getLeadDropboxDir(lead: Lead): string | null {
  if (!DROPBOX_ROOT || !lead.dropbox_path) return null;
  return path.join(DROPBOX_ROOT, lead.dropbox_path);
}

/**
 * Same resolution as getProjectDropboxDir, for a Permit QAQC engagement's real
 * Dropbox folder (Received/Sent/Admin/Reference) -- that folder already exists before
 * Mi ever links to it, so this only ever resolves a path, it never creates one.
 */
export function getPermitQaqcDropboxDir(engagement: PermitQaqcEngagement): string | null {
  if (!DROPBOX_ROOT || !engagement.dropbox_path) return null;
  return path.join(DROPBOX_ROOT, engagement.dropbox_path);
}

const MAX_DEPTH = 3;
const MAX_ENTRIES_PER_DIR = 500;

/** Lists a Dropbox folder's tree, bounded in depth/breadth — browsing metadata only, never reads file contents. */
export function listDropboxTree(rootDir: string): DropboxNode[] {
  function walk(dir: string, relativeDir: string, depth: number): DropboxNode[] {
    if (!fs.existsSync(dir) || depth > MAX_DEPTH) return [];
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith("."))
      .slice(0, MAX_ENTRIES_PER_DIR);

    return entries
      .map((entry): DropboxNode => {
        const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            relativePath,
            isDirectory: true,
            children: walk(path.join(dir, entry.name), relativePath, depth + 1),
          };
        }
        return { name: entry.name, relativePath, isDirectory: false };
      })
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
  }

  return walk(rootDir, "", 0);
}
