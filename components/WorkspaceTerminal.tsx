"use client";

import { TerminalPanel } from "@/components/TerminalPanel";
import { ProjectPdfFinder } from "@/components/ProjectPdfFinder";
import { CadConnections, CadPairingBanner } from "@/components/CadConnections";
import { ResolvedTerminalWorkspace } from "./ResolvedTerminalWorkspace";
import { useEffect, useRef, useState } from "react";
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
export function WorkspaceTerminal({ workspace, resizable = false }: { workspace: string; resizable?: boolean }) {
  return <ResolvedTerminalWorkspace workspace={workspace}>{current => <RememberedWorkspaceTerminal key={current} workspace={current} resizable={resizable} />}</ResolvedTerminalWorkspace>;
}

const TERMINAL_HEIGHT_KEY = "mi:terminal-height";
const clampHeight = (value: number) => Math.round(Math.min(2400, Math.max(200, value)));

/** A bar under the terminal. It reports heights; the caller keeps and remembers them. */
function TerminalHeightHandle({ height, onChange, onReset }: {
  height: number;
  onChange: (height: number, done: boolean) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ y: number; height: number } | null>(null);
  function startDrag(event: React.PointerEvent) {
    event.preventDefault();
    drag.current = { y: event.clientY, height };
    const move = (next: PointerEvent) => {
      if (drag.current) onChange(drag.current.height + next.clientY - drag.current.y, false);
    };
    const end = (next: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      if (drag.current) onChange(drag.current.height + next.clientY - drag.current.y, true);
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }
  return <div
    role="separator"
    aria-orientation="horizontal"
    aria-label="Terminal height"
    aria-valuenow={height}
    tabIndex={0}
    title="Drag to resize. Double-click to reset."
    onPointerDown={startDrag}
    onDoubleClick={onReset}
    onKeyDown={(event) => {
      if (event.key === "ArrowUp") { event.preventDefault(); onChange(height - 40, true); }
      if (event.key === "ArrowDown") { event.preventDefault(); onChange(height + 40, true); }
    }}
    className="group flex h-4 shrink-0 cursor-row-resize touch-none items-center justify-center rounded-b-xl border-t border-border hover:bg-accent/15 focus-visible:bg-accent/15 focus-visible:outline-none"
  >
    <span aria-hidden="true" className="h-1 w-12 rounded-full bg-muted-foreground/50 group-hover:bg-accent" />
  </div>;
}

function RememberedWorkspaceTerminal({ workspace, resizable }: { workspace: string; resizable: boolean }) {
  const [session, setSession] = useState<string | null>(null);
  const [height, setHeight] = useState(640);
  useEffect(() => {
    if (!resizable) return;
    let saved = Number.NaN;
    try { saved = Number(window.localStorage.getItem(TERMINAL_HEIGHT_KEY) ?? Number.NaN); } catch { /* Use the default. */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window size and preference exist only after hydration
    setHeight(clampHeight(Number.isFinite(saved) ? saved : window.innerHeight * 0.72));
  }, [resizable]);
  function changeHeight(next: number, done: boolean) {
    const value = clampHeight(next);
    setHeight(value);
    if (!done) return;
    try { window.localStorage.setItem(TERMINAL_HEIGHT_KEY, String(value)); } catch { /* Kept for this view. */ }
  }
  function resetHeight() {
    setHeight(clampHeight(window.innerHeight * 0.72));
    try { window.localStorage.removeItem(TERMINAL_HEIGHT_KEY); } catch { /* Nothing to forget. */ }
  }
  const desktop = useDesktopPaneWindows();
  const panes = useWorkspacePaneState();
  // While the shown session runs a CAD agent, the PDF and setup rows give the terminal their room.
  const [cadAgent, setCadAgent] = useState(false);
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
    <div className={`flex flex-col rounded-xl border border-border bg-background shadow-[0_12px_40px_-20px_#000] ${resizable ? "" : "h-full min-h-0 overflow-y-auto"}`}>
      {/* CAD agents started here run in a free session of this terminal, which is then shown. */}
      {/^projects\/[a-z0-9][a-z0-9-]*$/.test(workspace) && <CadPairingBanner workspace={workspace} session={session} onAgent={setCadAgent} onAgentStarted={selectSession} />}
      {!cadAgent && /^projects\/[a-z0-9][a-z0-9-]*$/.test(workspace) && <div className="shrink-0 border-b border-border p-2"><ProjectPdfFinder slug={workspace.slice(9)} /></div>}
      {!cadAgent && /^projects\/[a-z0-9][a-z0-9-]*$/.test(workspace) && <CadConnections key={workspace} workspace={workspace} onAgentStarted={selectSession} />}
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
      <div className={resizable ? "shrink-0" : "min-h-[max(24rem,70dvh)] flex-1 shrink-0"} style={resizable ? { height } : undefined}>
        <WorkspaceSession key={`${workspace}:${session}`} workspace={workspace} session={session} />
      </div>
      {resizable && <TerminalHeightHandle height={height} onChange={changeHeight} onReset={resetHeight} />}
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
