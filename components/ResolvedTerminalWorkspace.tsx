"use client";

import { useEffect, useState, type ReactNode } from "react";
import { workspaceDisplayName } from "./workspacePanes";

/** Resolve before choosing a Web Lock, session key, or pop-out identity. */
export function ResolvedTerminalWorkspace({ workspace, children }: {
  workspace: string;
  children: (workspace: string) => ReactNode;
}) {
  const [result, setResult] = useState<{ requested: string; workspace?: string; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    let request = 0;
    async function resolve() {
      const sequence = ++request;
      try {
        const current = window.electronAPI?.terminal.resolveWorkspace
          ? await window.electronAPI.terminal.resolveWorkspace(workspace)
          : workspace;
        if (!disposed && sequence === request) setResult({ requested: workspace, workspace: current });
      } catch (cause) {
        if (!disposed && sequence === request) setResult({ requested: workspace, error: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    void resolve();
    window.addEventListener("focus", resolve);
    return () => { disposed = true; window.removeEventListener("focus", resolve); };
  }, [workspace, retry]);
  if (!result || result.requested !== workspace) return <p role="status" className="p-4 text-sm">Opening terminal…</p>;
  if (!result.workspace) return <div role="alert" className="p-4 text-sm">
    <p>{result.error}</p>
    <button type="button" className="mt-2 rounded border border-border px-3 py-1" onClick={() => setRetry(value => value + 1)}>Retry workspace link</button>
  </div>;
  return <div className="flex h-full min-h-0 flex-col">
    {result.workspace !== workspace && <p role="status" className="shrink-0 border-b border-border px-3 py-2 text-xs text-muted-foreground">
      This record uses the terminal and current folder of <a className="underline" href={`/${result.workspace}`}>{workspaceDisplayName(result.workspace)}</a>.
    </p>}
    <div className="min-h-0 flex-1">{children(result.workspace)}</div>
  </div>;
}
