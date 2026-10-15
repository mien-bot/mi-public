import { ROOT_PROJECT_VALUE } from "./chatTypes";

export const PROJECT_CHAT_OPEN_EVENT = "mi:open-project-chat";

/**
 * Dispatched after a project record is created, so long-lived UI holding a fetched-once
 * project list can refresh it. ChatWidget lives in the root layout and never unmounts across
 * navigation, so without this a just-created project stays missing from its launch contract --
 * reported as "The requested project chat ... is not available locally" -- for the rest of the
 * session, even though the record exists on disk.
 */
export const PROJECT_LIST_CHANGED_EVENT = "mi:projects-changed";
/** Project chat and the workspace page share the same durable terminal sessions. */
export type ProjectAiPanelTab = "chat" | "terminal" | "interview";

export interface ProjectChatOpenDetail {
  slug: string;
  tab: ProjectAiPanelTab;
  fresh?: boolean;
  prompt?: string;
  onResult?: (error: string | null) => void;
}

export interface ProjectChatPanelContext {
  embeddedInProject: boolean;
  projectName: string | null;
  projectHref: `/projects/${string}` | null;
}

export function createProjectChatOpenDetail(
  slug: string,
  tab: ProjectAiPanelTab = "chat",
): ProjectChatOpenDetail {
  return { slug, tab };
}

export function getProjectChatPanelContext({
  pathname,
  projectSlug,
  projectName,
}: {
  pathname: string;
  projectSlug: string | null;
  projectName: string | null;
}): ProjectChatPanelContext {
  if (!projectSlug || projectSlug === ROOT_PROJECT_VALUE) {
    return {
      embeddedInProject: false,
      projectName: null,
      projectHref: null,
    };
  }

  const projectHref = `/projects/${projectSlug}` as const;
  return {
    embeddedInProject:
      pathname === projectHref || pathname.startsWith(`${projectHref}/`),
    projectName: projectName?.trim() || projectSlug,
    projectHref,
  };
}
