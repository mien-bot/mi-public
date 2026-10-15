"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TerminalPanel } from "@/components/TerminalPanel";
import { ProjectPdfFinder } from "@/components/ProjectPdfFinder";
import { OpenTerminalButton } from "./OpenTerminalButton";
import { normalizeWorkspaceCwd, workspaceDisplayName } from "@/components/workspacePanes";

/**
 * The Terminal surface as a standalone pinned card, matching ChatWidget's compact-chat
 * chrome so the two pop-outs read as the same object: drag by the titlebar, pin, minimize,
 * dismiss. Dismissing only hides the window -- the pty behind it stays alive, and the
 * workspace page picks the same session back up.
 */
export function TerminalPaneWindow() {
  const workspace = normalizeWorkspaceCwd(useSearchParams().get("workspace"));
  const requestedSession = useSearchParams().get("session") ?? "1";
  const session = /^[1-4]$/.test(requestedSession) ? requestedSession : "1";
  const [pinned, setPinned] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Electron preload exists only after hydration
    setMounted(true);
  }, []);

  async function windowAction(action: "hide" | "minimize" | "toggle-pin") {
    const panes = window.electronAPI?.windows;
    if (!panes?.paneAction) {
      if (action === "hide") window.close();
      return;
    }
    try {
      const state = await panes.paneAction(action);
      setPinned(state.pinned);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  // Mi's server answers on 127.0.0.1 whether or not the request came from the desktop app,
  // so this route can be opened in an ordinary browser -- from history, a bookmark, or a
  // shared link. The pty is only reachable over Electron IPC, and none of this window's
  // chrome (pin, minimize, hide) means anything there either, so say so and point at the
  // workspace instead of drawing a card with a dead shell in it.
  if (mounted && !window.electronAPI) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 overflow-auto bg-background p-8 text-center">
        <div className="grid h-11 w-11 place-items-center rounded-lg border border-border bg-muted/50 font-mono text-sm text-accent" aria-hidden="true">
          &gt;_
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">This terminal needs the Mi desktop app</p>
          <p className="mt-1 text-xs capitalize text-muted-foreground">{workspaceDisplayName(workspace)}</p>
          <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-muted-foreground">
            The shell runs inside Mi itself, so a browser tab has nothing to attach to. Open Mi,
            go to this workspace, and use Terminal there.
          </p>
        </div>
        <Link
          href={workspace === "." ? "/" : `/${workspace}`}
          className="tactile-control rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-xs text-foreground transition-colors hover:bg-accent/20"
        >
          Open this workspace
        </Link>
        {/^projects\/[a-z0-9][a-z0-9-]*$/.test(workspace) && <ProjectPdfFinder slug={workspace.slice(9)} />}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background">
      <div className="mi-window-drag mi-terminal-titlebar flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <div className="grid h-6 w-6 shrink-0 place-items-center rounded border border-border bg-muted/50 font-mono text-[10px] text-accent" aria-hidden="true">
          &gt;_
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">Mi Terminal · Session {session}</p>
          <p className="truncate text-[10px] capitalize text-muted-foreground" title={workspaceDisplayName(workspace)}>
            {workspaceDisplayName(workspace)}
          </p>
        </div>
        <div className="mi-window-no-drag flex items-center gap-1">
          <div className="text-foreground"><OpenTerminalButton workspace={workspace} current={session} compact /></div>
          <button
            type="button"
            onClick={() => void windowAction("toggle-pin")}
            title={pinned ? "Unpin from top" : "Keep on top"}
            aria-label={pinned ? "Unpin terminal window" : "Pin terminal window on top"}
            aria-pressed={pinned}
            className={`tactile-control flex h-7 w-7 items-center justify-center rounded text-xs transition-colors hover:bg-muted ${
              pinned ? "text-accent" : "text-muted-foreground"
            }`}
          >
            ◇
          </button>
          <button
            type="button"
            onClick={() => void windowAction("minimize")}
            title="Minimize"
            aria-label="Minimize terminal window"
            className="tactile-control flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => void windowAction("hide")}
            title="Hide (the shell keeps running)"
            aria-label="Hide terminal window"
            className="tactile-control flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            ×
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="border-b border-red-400/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
      {/^projects\/[a-z0-9][a-z0-9-]*$/.test(workspace) && <div className="shrink-0 border-b border-border p-2"><ProjectPdfFinder slug={workspace.slice(9)} /></div>}
      <div className="min-h-0 flex-1">
        <TerminalPanel cwd={workspace} session={session} compact chromeless />
      </div>
    </div>
  );
}
