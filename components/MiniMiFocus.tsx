"use client";
import { useState } from "react";
import { setFocus, useCompanionClock, useFocusSession } from "@/lib/miniMi/focus";

export function MiniMiFocus() {
  const session = useFocusSession();
  const now = useCompanionClock(Boolean(session));
  const [minutes, setMinutes] = useState(25);
  const [error, setError] = useState(false);
  const left = session ? Math.max(0, Math.ceil((session.endsAt - now) / 1000)) : 0;
  const complete = session && now > 0 && left === 0;
  return <div className="space-y-2 text-xs" aria-label="Mini Mi focus timer">
    <p className="font-medium">Focus session</p>
    <p className="text-muted-foreground">An optional quiet timer. No sounds, automatic task changes, or automatic restarts.</p>
    {session ? <>
      <p role="status">{complete ? session.phase === "focus" ? "Focus complete. Time for a break." : "Break complete. Ready when you are." : `${session.phase === "focus" ? "Focus" : "Break"} in progress`}</p>
      {!complete && <p className="font-mono" aria-label="Time remaining">{now ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2,"0")}` : "Loading timer…"}</p>}
      <div className="flex flex-wrap gap-2">
        {complete && session.phase === "focus" && <button type="button" className="rounded border border-border px-3 py-2" onClick={() => setError(!setFocus({ phase: "break", minutes: 5, endsAt: Date.now() + 300000 }))}>Start 5-minute break</button>}
        <button type="button" className="rounded border border-border px-3 py-2" onClick={() => setError(!setFocus(null))}>{complete ? "Dismiss timer" : "Stop timer"}</button>
      </div>
    </> : <div className="flex flex-wrap items-center gap-2">
      <label>Minutes <select aria-label="Focus minutes" value={minutes} onChange={e => setMinutes(Number(e.target.value))} className="rounded border border-border bg-card p-2">{[15,25,45].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <button type="button" className="rounded border border-border px-3 py-2" onClick={() => setError(!setFocus({ phase: "focus", minutes, endsAt: Date.now() + minutes * 60000 }))}>Start focus</button>
    </div>}
    {error && <p role="alert">The timer could not be saved on this device.</p>}
  </div>;
}
