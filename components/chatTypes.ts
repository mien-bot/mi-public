import type { AgentEngine } from "@/types/electron";
import type { ProjectCopilotProposal } from "@/lib/projectCopilot";

export type { AgentEngine };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  pending?: boolean;
  createdAt: number;
  proposals?: ProjectCopilotProposal[];
  proposalError?: string | null;
  /** Set when this error is the "Repair/Refresh Agent Workspace" gate — renders a direct link to fix it. */
  workspaceRepairSlug?: string | null;
}

export interface ThreadState {
  messages: ChatMessage[];
  sessionId: string | null;
  activeRequestId: string | null;
  title: string;
  engine: AgentEngine;
  model: string;
  projectSlug: string;
  createdAt: number;
  updatedAt: number;
}

export type ThreadKey = string;

// A project-less thread (repo root) is keyed by this sentinel rather than "".
export const ROOT_PROJECT_VALUE = "__root__";

// model is part of the key (not just engine/project) — resuming a CLI session
// under a different --model is unverified behavior, so switching model always
// starts a fresh thread instead, same as switching engine or project does.
//
// `mode` is optional and defaults to "chat" so every pre-existing call site
// (which only ever passes three arguments) produces the exact same key string
// as before this parameter existed. Guided-interview callers pass "interview"
// so their derived keys are namespaced apart from free-form chat history for
// the same project/engine/model, without touching free-form chat's keys at all.
export function makeThreadKey(
  engine: AgentEngine,
  model: string | null,
  projectSlug: string,
  mode: "chat" | "interview" = "chat",
): ThreadKey {
  const base = `${engine}::${model || "default"}::${projectSlug || ROOT_PROJECT_VALUE}`;
  return mode === "interview" ? `${base}::interview` : base;
}

export function emptyThread(input: {
  engine?: AgentEngine;
  model?: string | null;
  projectSlug?: string;
  now?: number;
} = {}): ThreadState {
  const now = input.now ?? Date.now();
  return {
    messages: [],
    sessionId: null,
    activeRequestId: null,
    title: "New chat",
    engine: input.engine ?? "claude",
    model: input.model ?? "",
    projectSlug: input.projectSlug ?? ROOT_PROJECT_VALUE,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * One open chat/terminal tab. `model` is deliberately not stored here -- it's always resolved
 * live as `modelsByEngine[tab.engine]` (see components/chatPreferences.ts), matching the
 * pre-tabs behavior where changing the remembered model for an engine already reactively
 * changed which thread was visible (model is part of ThreadKey).
 */
export interface OpenTab {
  /** Stable identity -- survives retargeting a tab to a different project/engine. */
  id: string;
  engine: AgentEngine;
  /** ROOT_PROJECT_VALUE for "no project". */
  projectSlug: string;
  /** Independent conversation identity, allowing multiple fresh chats for one project. */
  threadKey: ThreadKey;
}

/** Each open chat tab may hold a real child process, and each open terminal tab a real pty. */
export const MAX_OPEN_TABS = 6;

export function createTab(engine: AgentEngine, projectSlug: string, threadKey = crypto.randomUUID()): OpenTab {
  return { id: crypto.randomUUID(), engine, projectSlug, threadKey };
}

export interface TabsResult {
  tabs: OpenTab[];
  activeTabId: string;
}

/**
 * Opens a tab for the given engine/project, or activates the matching one if it's already
 * open (no duplicate tabs for the same target). No-ops (keeps current tabs/active) once
 * MAX_OPEN_TABS is reached.
 */
export function openTab(
  tabs: OpenTab[],
  activeTabId: string,
  target: { engine: AgentEngine; projectSlug: string },
  options: { forceNew?: boolean; threadKey?: string } = {},
): TabsResult {
  const existing = options.forceNew
    ? undefined
    : tabs.find((t) => t.engine === target.engine && t.projectSlug === target.projectSlug);
  if (existing) return { tabs, activeTabId: existing.id };
  if (tabs.length >= MAX_OPEN_TABS) return { tabs, activeTabId };
  const tab = createTab(target.engine, target.projectSlug, options.threadKey);
  return { tabs: [...tabs, tab], activeTabId: tab.id };
}

/**
 * Closes a tab. If it was the last one open, replaces it with a fresh root/claude tab rather
 * than leaving zero tabs. If it was the active tab, activates its nearest remaining neighbor.
 */
export function closeTab(tabs: OpenTab[], activeTabId: string, id: string): TabsResult {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return { tabs, activeTabId };

  const remaining = tabs.filter((t) => t.id !== id);
  if (remaining.length === 0) {
    const fresh = createTab("claude", ROOT_PROJECT_VALUE);
    return { tabs: [fresh], activeTabId: fresh.id };
  }
  if (activeTabId !== id) return { tabs: remaining, activeTabId };

  const neighborIndex = Math.min(index, remaining.length - 1);
  return { tabs: remaining, activeTabId: remaining[neighborIndex].id };
}
