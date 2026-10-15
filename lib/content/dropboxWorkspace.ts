import { getProject, getProjectSlugs } from "./projects";
import { getLead, getLeadSlugs } from "./leads";
import { getPermitQaqcEngagement, getPermitQaqcSlugs } from "./permitQaqc";
import { DROPBOX_ROOT } from "./paths";
import { healthPath } from "./dropboxHealth";

/** Resolves only an existing workspace's human-confirmed mapping. */
export async function dropboxWorkspaceRoot(kind: string, slug: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) || !DROPBOX_ROOT) throw new Error("Dropbox is not configured or this workspace is unavailable.");
  let relative: string | null | undefined;
  if (kind === "projects" && getProjectSlugs().includes(slug)) relative = getProject(slug).meta.dropbox_path;
  else if (kind === "leads" && getLeadSlugs().includes(slug)) relative = getLead(slug).lead.dropbox_path;
  else if (kind === "permit-qaqc" && getPermitQaqcSlugs().includes(slug)) relative = getPermitQaqcEngagement(slug).engagement.dropbox_path;
  if (!relative) throw new Error("No confirmed Dropbox folder is available for this workspace.");
  return healthPath(DROPBOX_ROOT, relative.replaceAll("\\", "/"));
}
