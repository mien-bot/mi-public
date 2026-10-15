"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** One xterm view per durable shell, including separate Electron windows. A queued
 * view acquires the lock only after the old view has disposed its input/resize handlers.
 * Closing a renderer also releases its browser-owned lock automatically. */
export function TerminalViewGuard({ sessionKey, children }: { sessionKey: string; children: ReactNode }) {
  const [requested, setRequested] = useState(true);
  const [state, setState] = useState<"waiting" | "owned" | "browser" | "unavailable">("waiting");
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (!window.electronAPI) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- detect the preload bridge after hydration
      setState("browser");
      return;
    }
    if (!navigator.locks) {
      setState("unavailable");
      return;
    }
    if (!requested) return;
    const abort = new AbortController();
    const channel = new BroadcastChannel(`mi-terminal-view:${sessionKey}`);
    channelRef.current = channel;
    let owned = false;
    let release: (() => void) | undefined;
    channel.onmessage = ({ data }) => {
      if (data !== "yield" || !owned) return;
      setState("waiting");
      setRequested(false);
    };
    void navigator.locks.request(`mi-terminal-view:${sessionKey}`, { signal: abort.signal }, async () => {
      if (abort.signal.aborted) return;
      owned = true;
      setState("owned");
      await new Promise<void>(resolve => { release = resolve; });
    }).catch(() => {
      if (!abort.signal.aborted) setState("unavailable");
    });
    return () => {
      channelRef.current = null;
      channel.close();
      abort.abort();
      release?.();
    };
  }, [sessionKey, requested]);

  if (state === "owned" || state === "browser") return children;
  return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-4 text-center text-sm text-foreground" role="status">
    <p>{state === "unavailable" ? "This terminal view could not connect safely. Reopen the window to try again." : "Waiting for this terminal session. It may be open in another view."}</p>
    {state === "waiting" && <button type="button" className="rounded-md border border-accent/50 px-3 py-2 text-xs" onClick={() => {
      if (!requested) setRequested(true);
      // A fresh channel also reaches a view in this same renderer. The Web Lock, not
      // this notification, arbitrates ownership and prevents overlapping xterm mounts.
      const channel = new BroadcastChannel(`mi-terminal-view:${sessionKey}`);
      channel.postMessage("yield");
      channel.close();
    }}>Show session here</button>}
  </div>;
}
