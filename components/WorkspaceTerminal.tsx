"use client";

import { TerminalPanel } from "@/components/TerminalPanel";
import { ProjectPdfFinder } from "@/components/ProjectPdfFinder";
import { ResolvedTerminalWorkspace } from "./ResolvedTerminalWorkspace";
import { useEffect, useState } from "react";
import { OpenTerminalButton } from "./OpenTerminalButton";
import { TERMINAL_SESSIONS } from "./terminalSessions";
import {
  closeWorkspacePane,
  openTerminalPane,
  useWorkspacePaneState,
  workspaceDisplayName,
  useDesktopPaneWindows,
} from "@/components/workspacePanes";

/**
 * The page-embedded terminal, aware of its own pop-out card.
 *
 * Both views attach to the same durable pty by workspace/session key, so mounting them at once
 * would leave two xterm instances fighting over the pty's columns and rows. While the card
 * is on screen this stands down and points at it instead -- the shell keeps running either
 * way, which is the whole promise of the persistent session.
 */
export function WorkspaceTerminal({ workspace }: { workspace: string }) {
  return <ResolvedTerminalWorkspace workspace={workspace}>{current => <RememberedWorkspaceTerminal key={current} workspace={current} />}</ResolvedTerminalWorkspace>;
}

function RememberedWorkspaceTerminal({ workspace }: { workspace: string }) {
  const [session, setSession] = useState<string | null>(null);
  const desktop = useDesktopPaneWindows();
  const panes = useWorkspacePaneState();
  const preferenceKey = `mi:terminal-session:${workspace}`;
  useEffect(() => {
    let saved = "1";
    try {
      const value = window.localStorage.getItem(preferenceKey);
      if (TERMINAL_SESSIONS.some(slot => slot === value)) saved = value!;
    } catch { /* Session 1 remains available if preferences cannot be read. */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore after hydration before attaching a PTY
    setSession(saved);
  }, [preferenceKey]);
  function selectSession(slot: string) {
    setSession(slot);
    try { window.localStorage.setItem(preferenceKey, slot); } catch { /* Keep this view usable. */ }
  }
  if (session === null) return <div role="status" className="p-4 text-sm text-muted-foreground">Opening terminal…</div>;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto rounded-xl border border-border bg-background shadow-[0_12px_40px_-20px_#000]">
      {/^projects\/[a-z0-9][a-z0-9-]*$/.test(workspace) && <div className="shrink-0 border-b border-border p-2"><ProjectPdfFinder slug={workspace.slice(9)} /></div>}
      {desktop && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border mi-terminal-titlebar px-3 py-2">
          <div className="flex flex-wrap gap-1" aria-label="Terminal sessions">
            {TERMINAL_SESSIONS.map((slot) => (
              <button key={slot} type="button" aria-pressed={session === slot} onClick={() => selectSession(slot)}
                className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${session === slot ? "border-accent/60 bg-accent/15 text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                <span aria-hidden="true" className="mr-1.5 font-mono opacity-60">&gt;_</span>Session {slot}
                {panes.terminals.some(pane => pane.workspace === workspace && pane.session === slot) && <span className="ml-1 text-[10px]">↗ Window</span>}
              </button>
            ))}
          </div>
          <div className="text-foreground"><OpenTerminalButton workspace={workspace} current={session} /></div>
          <p className="w-full text-[10px] text-muted-foreground">Four project sessions · output saved locally · closing a window keeps its shell running</p>
        </div>
      )}
      {/* Short hosts scroll the tools and shell instead of collapsing the PTY viewport. */}
      <div className="min-h-[24rem] flex-1 shrink-0">
        <WorkspaceSession key={`${workspace}:${session}`} workspace={workspace} session={session} />
      </div>
    </div>
  );
}

function WorkspaceSession({ workspace, session }: { workspace: string; session: string }) {
  const panes = useWorkspacePaneState();
  const desktop = useDesktopPaneWindows();
  const poppedOut = panes.terminals?.some((pane) => pane.workspace === workspace && pane.session === session);

  if (poppedOut) {
    return (
      <div className="mi-terminal-shell flex h-full min-h-[18rem] flex-col items-center justify-center gap-4 rounded-xl border p-8 text-center">
        <div className="grid h-11 w-11 place-items-center rounded-lg border border-border bg-muted/50 font-mono text-sm text-accent" aria-hidden="true">
          &gt;_
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Session {session} is in its own window</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {workspaceDisplayName(workspace)} · the shell keeps running wherever it is shown.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => openTerminalPane(workspace, session)}
            className="tactile-control rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-xs text-foreground transition-colors hover:bg-accent/20"
          >
            Focus that window
          </button>
          <button
            type="button"
            onClick={() => closeWorkspacePane("terminal", workspace, session)}
            className="tactile-control rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
          >
            Bring it back here
          </button>
        </div>
      </div>
    );
  }

  return (
    <TerminalPanel
      cwd={workspace}
      session={session}
      compact
      chromeless
      onPopOut={desktop ? () => openTerminalPane(workspace, session) : undefined}
    />
  );
}
