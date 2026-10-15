import type { AgentEngine } from "@/types/electron";
import {
  ROOT_PROJECT_VALUE,
  makeThreadKey,
  type ThreadKey,
} from "./chatTypes";

const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface ProjectChatLaunch {
  projectSlug: string;
  cwd: "." | `projects/${string}`;
  threadKey: ThreadKey;
  error: string | null;
}

interface ResolveProjectChatLaunchOptions {
  /**
   * An explicit URL, event, or picker target. `undefined` means there is no
   * launch request and the saved preference may be restored instead.
   */
  requestedSlug?: string | null;
  preferredSlug?: string | null;
  availableSlugs: readonly string[];
  engine: AgentEngine;
  model: string | null;
}

function rootLaunch(
  engine: AgentEngine,
  model: string | null,
  error: string | null,
): ProjectChatLaunch {
  return {
    projectSlug: ROOT_PROJECT_VALUE,
    cwd: ".",
    threadKey: makeThreadKey(engine, model, ROOT_PROJECT_VALUE),
    error,
  };
}

export function resolveProjectChatLaunch({
  requestedSlug,
  preferredSlug,
  availableSlugs,
  engine,
  model,
}: ResolveProjectChatLaunchOptions): ProjectChatLaunch {
  const hasExplicitRequest = requestedSlug !== undefined;
  const candidate = hasExplicitRequest
    ? requestedSlug
    : preferredSlug ?? ROOT_PROJECT_VALUE;

  if (candidate === ROOT_PROJECT_VALUE) {
    return rootLaunch(engine, model, null);
  }

  const isValid =
    typeof candidate === "string" &&
    PROJECT_SLUG_PATTERN.test(candidate) &&
    availableSlugs.includes(candidate);

  if (!isValid) {
    const target = typeof candidate === "string" && candidate.length > 0
      ? ` "${candidate}"`
      : "";
    const source = hasExplicitRequest ? "requested" : "saved";
    return rootLaunch(
      engine,
      model,
      `The ${source} project chat${target} is not available locally. Root chat is active.`,
    );
  }

  return {
    projectSlug: candidate,
    cwd: `projects/${candidate}`,
    threadKey: makeThreadKey(engine, model, candidate),
    error: null,
  };
}
