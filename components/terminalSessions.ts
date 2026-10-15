export const TERMINAL_SESSIONS = ["1", "2", "3", "4"] as const;

/** Reopen durable shells; never replace an occupied window or the current view. */
export function nextTerminalSession(workspace: string, panes: { workspace: string; session: string }[], current?: string): string | undefined {
  return TERMINAL_SESSIONS.find(session => session !== current && !panes.some(pane => pane.workspace === workspace && pane.session === session));
}
