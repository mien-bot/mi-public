"use client";

import { useState } from "react";
import { nextTerminalSession } from "./terminalSessions";
import { normalizeWorkspaceCwd, useDesktopPaneWindows, useWorkspacePaneState } from "./workspacePanes";

export function OpenTerminalButton({ workspace, current, compact = false }: { workspace: string; current?: string; compact?: boolean }) {
  const desktop = useDesktopPaneWindows();
  const panes = useWorkspacePaneState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cwd = normalizeWorkspaceCwd(workspace);
  const available = nextTerminalSession(cwd, panes.terminals, current);
  if (!desktop) return null;

  async function openAnother() {
    const windows = window.electronAPI?.windows;
    if (!windows || busy) return;
    setBusy(true);
    setError(null);
    try {
      const canonical = await window.electronAPI!.terminal.resolveWorkspace(cwd);
      // Recheck immediately before opening: another window can change the session list.
      const latest = await windows.paneState();
      const session = nextTerminalSession(canonical, latest.terminals, current);
      if (!session) throw new Error("All four sessions are already in use. Focus an existing terminal window.");
      const result = await windows.openPane("terminal", { workspace: canonical, session });
      if (!result.opened) throw new Error("The terminal window could not open. Please try again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open a terminal window.");
    } finally { setBusy(false); }
  }

  return <div className="mi-window-no-drag flex flex-col items-start gap-1">
    <button type="button" disabled={busy || !available} onClick={() => void openAnother()}
      aria-label="Open another terminal" title={available ? "Open another session in a window that stays on top" : "All four sessions are in use"}
      className="tactile-control rounded-md border border-current/25 px-2 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50">
      {busy ? "Opening…" : compact ? "+ Terminal" : "+ Open another terminal"}
    </button>
    {error && <span role="alert" className="max-w-xs text-xs">{error}</span>}
  </div>;
}
