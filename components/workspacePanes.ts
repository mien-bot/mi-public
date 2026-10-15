"use client";

import { useEffect, useState } from "react";

/**
 * Talk to Mi and Terminal are peers: either can stay docked in the page or be popped out
 * into its own pinned card window (electron/desktopMain.js's pane windows). This module is
 * the renderer half of that contract -- one place that knows how to open, close, and read
 * the state of those cards, so every workspace offers the same two moves.
 */
export type WorkspacePaneKind = "chat" | "terminal";

export interface WorkspacePaneState {
  /** The Talk to Mi card is open and on screen. */
  chat: boolean;
  /** Project slug the Talk to Mi card is pointed at; null for firm-wide and personal chat. */
  chatProject: string | null;
  /** Workspace cwd the terminal card is showing, or null when no terminal card is on screen. */
  terminalWorkspace: string | null;
  terminals: { workspace: string; session: string }[];
}

export const EMPTY_PANE_STATE: WorkspacePaneState = {
  chat: false,
  chatProject: null,
  terminalWorkspace: null,
  terminals: [],
};

/** Matches electron/desktopChatLifecycle.js's normalizePaneWorkspace. */
const PANE_WORKSPACE_PATTERN = /^(?:projects|leads|permit-qaqc)\/[a-z0-9][a-z0-9-]*$/;

/**
 * Routes that are the whole content of a pop-out card window rather than a page inside the
 * app shell. They draw their own titlebar and cover the window with a fixed, full-bleed
 * surface, so the shell has to step aside for them completely: no app header, and no
 * animated route wrapper (its `transform`/`filter` would become the containing block for
 * `position: fixed`, collapsing the card to the wrapper's zero-height box -- which is exactly
 * how the terminal card once opened as an empty window).
 */
const PANE_WINDOW_ROUTES = new Set(["/chat", "/personal/window", "/terminal/window"]);

export function isPaneWindowRoute(pathname: string): boolean {
  return PANE_WINDOW_ROUTES.has(pathname);
}

export function normalizeWorkspaceCwd(value: string | null | undefined): string {
  const workspace = String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  return PANE_WORKSPACE_PATTERN.test(workspace) ? workspace : ".";
}

/** Human name for a workspace cwd, used in titlebars and pop-out placeholders. */
export function workspaceDisplayName(cwd: string): string {
  const workspace = normalizeWorkspaceCwd(cwd);
  if (workspace === ".") return "Firm + personal";
  const [kind, slug] = workspace.split("/");
  const name = slug.replaceAll("-", " ");
  if (kind === "leads") return `Lead · ${name}`;
  if (kind === "permit-qaqc") return `QA/QC · ${name}`;
  return name;
}

/**
 * Whether pinned pane windows exist at all. Only the desktop app can open one, so this is
 * what every pop-out control has to gate on. Mi's own server is reachable from an ordinary
 * browser (the packaged app serves it on 127.0.0.1:3050), and a browser tab there has no
 * Electron IPC.
 */
export function paneWindowsAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.electronAPI?.windows?.openPane);
}

/** paneWindowsAvailable() for render. Reads false until after hydration -- the preload
 * bridge does not exist before it -- so a pop-out control is never offered as live before
 * we know it can be. */
export function useDesktopPaneWindows(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Electron preload exists only after hydration
    setAvailable(paneWindowsAvailable());
  }, []);

  return available;
}

/**
 * Pops the terminal out into its pinned card. Desktop only, and deliberately without a
 * browser fallback: the pty lives in the Electron main process and is only reachable over
 * IPC, so a `window.open` card in a browser tab could only ever render TerminalPanel's "no
 * local shell to attach to" notice. Opening a window that cannot work is worse than not
 * offering the move, so callers gate the control on useDesktopPaneWindows() instead.
 */
export function openTerminalPane(workspace: string, session = "1"): void {
  const panes = window.electronAPI?.windows;
  if (!panes?.openPane) return;
  void panes.openPane("terminal", { workspace: normalizeWorkspaceCwd(workspace), session });
}

export function openChatPane(projectSlug?: string | null): void {
  const panes = window.electronAPI?.windows;
  if (panes?.openPane) {
    void panes.openPane("chat", { projectSlug: projectSlug ?? undefined });
    return;
  }
  const params = new URLSearchParams({ compactChat: "1" });
  if (projectSlug) params.set("project", projectSlug);
  window.open(`/chat?${params.toString()}`, "mi-compact-chat", "popup,width=480,height=680");
}

export function closeWorkspacePane(kind: WorkspacePaneKind, workspace?: string, session = "1"): void {
  void window.electronAPI?.windows.closePane?.(kind, { workspace, session }).catch(() => {});
}

/**
 * Settings > "Show Terminal in the project workspace" (electron/configStore.js's
 * terminalPanelEnabled). Starts on, matching the stored default, so the control does not
 * flicker into the workspace header on every project page load.
 */
export function useTerminalSurfaceEnabled(): boolean {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    window.electronAPI?.setup?.get()
      .then(({ config }) => setEnabled(config.terminalPanelEnabled !== false))
      .catch(() => {
        // A failed settings read leaves the documented default in place.
      });
  }, []);

  return enabled;
}

/** Live view of which surfaces are currently living in a pop-out card. Always reports
 * nothing outside the desktop app, where those cards do not exist. */
export function useWorkspacePaneState(): WorkspacePaneState {
  const [state, setState] = useState<WorkspacePaneState>(EMPTY_PANE_STATE);

  useEffect(() => {
    const panes = window.electronAPI?.windows;
    if (!panes?.onPaneState || !panes.paneState) return;
    let cancelled = false;
    void panes.paneState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        // A pane query that fails just means no card is claimed; the docked view stays.
      });
    const off = panes.onPaneState((next) => setState(next));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return state;
}
