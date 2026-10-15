import fs from "node:fs";
import path from "node:path";
import type { ProjectMeta } from "@/lib/schema";
import { PROJECTS_DIR } from "./paths";

/**
 * Thrown when a project's content_location is "dropbox" but the shared folder isn't
 * reachable right now (DROPBOX_ROOT unset, Dropbox client paused/offline, or the folder
 * hasn't finished syncing to this machine yet). Callers must not fall back to the local
 * root in this case -- that would silently fork the data between machines.
 */
export class ContentRootUnavailableError extends Error {
  slug: string;

  constructor(slug: string) {
    super(`Project "${slug}"'s Dropbox-shared data isn't reachable right now on this computer (check that Dropbox is running and has finished syncing).`);
    this.name = "ContentRootUnavailableError";
    this.slug = slug;
  }
}

export interface ProjectContentRoot {
  dir: string;
  shared: boolean;
}

/**
 * Every existing project defaults to content_location: "local" (see projectMetaSchema),
 * so this is a no-op returning today's per-user path until a project is explicitly
 * migrated (Phase 3). `dropboxRoot` is threaded in explicitly (rather than imported from
 * ./paths internally) so this stays a pure, easily testable function of its arguments; its
 * only caller (`contentDir` in ./projects) passes the real DROPBOX_ROOT constant.
 */
export function resolveProjectContentRoot(
  meta: ProjectMeta,
  slug: string,
  dropboxRoot: string | null,
): ProjectContentRoot {
  if (meta.content_location === "dropbox") {
    if (!dropboxRoot || !meta.dropbox_path) throw new ContentRootUnavailableError(slug);
    const dir = path.join(dropboxRoot, meta.dropbox_path, "Mi", "project");
    if (!fs.existsSync(dir)) throw new ContentRootUnavailableError(slug);
    return { dir, shared: true };
  }
  return { dir: path.join(PROJECTS_DIR, slug), shared: false };
}
