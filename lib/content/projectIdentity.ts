import type { ProjectDetails, ProjectMeta } from "@/lib/schema";

type TeamMember = ProjectMeta["team"][number];

export interface ProjectIdentity {
  address: string;
  client: string;
  team: TeamMember[];
}

type IdentityMeta = Pick<ProjectMeta, "address" | "client" | "team">;
type IdentityDetails = Pick<ProjectDetails, "address" | "client_name" | "team">;

/**
 * The single place address / client / team are resolved for display.
 *
 * These three facts live in two files. `project.yaml` is the per-machine project
 * registry — it has to carry them so listing, search and Notion mapping can work
 * without opening every project's content root, which may be an offline Dropbox
 * folder. `details.yaml` is the richer record a person or a confirmed proposal
 * actually edits. So `details.yaml` wins and `project.yaml` is the fallback,
 * matching the precedence the project details page already used.
 *
 * Every read goes through here so the two can never *appear* to disagree, and
 * writeProjectDetails mirrors back (see projectMetaIdentityMirror) so they do
 * not diverge on disk either. Do not add a fourth precedence rule somewhere
 * else: the drift this replaces was two files quietly holding different
 * addresses for the same project.
 */
export function resolveProjectIdentity(
  meta: IdentityMeta,
  details: IdentityDetails | null | undefined,
): ProjectIdentity {
  return {
    address: details?.address.trim() || meta.address,
    client: details?.client_name.trim() || meta.client,
    team: details && details.team.length > 0 ? details.team : meta.team,
  };
}

/**
 * The project.yaml fields a details write should carry back, or null when
 * nothing would change.
 *
 * Only non-empty details values propagate. A blank details field means "not
 * recorded here", not "erase the registry" — the registry copy may be the only
 * one a freshly imported project has, and blanking it would lose real data to
 * make two files agree, which is the wrong trade.
 */
export function projectMetaIdentityMirror(
  meta: IdentityMeta,
  details: IdentityDetails,
): Partial<IdentityMeta> | null {
  const patch: Partial<IdentityMeta> = {};
  const address = details.address.trim();
  const client = details.client_name.trim();
  if (address && address !== meta.address) patch.address = address;
  if (client && client !== meta.client) patch.client = client;
  if (details.team.length > 0 && JSON.stringify(details.team) !== JSON.stringify(meta.team)) {
    patch.team = details.team;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
