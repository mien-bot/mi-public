"use client";

import { useEffect, useRef, useState } from "react";
import type { ScheduleKind } from "@/lib/scheduleInsights";
import { ScheduleKindMark } from "./ScheduleKindMark";
import { KIND_LABEL, SCHEDULE_KINDS } from "./scheduleKindStyle";

/** Esc closes the top card, even after a click has moved focus out of it. */
export function useEscape(onEscape: () => void) {
  const latest = useRef(onEscape);
  useEffect(() => { latest.current = onEscape; });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || document.querySelectorAll("[aria-modal='true']").length > 1) return;
      latest.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

const SHORTCUTS: [string, string][] = [
  ["C", "Add an item"],
  ["T", "Go to today"],
  ["← → or J K", "Previous or next"],
  ["Y M W R D", "Year, month, week, work week, day"],
  ["Esc", "Close or cancel"],
  ["?", "Show these shortcuts"],
];

export function CalendarShortcuts({ views = true, onClose }: { views?: boolean; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  useEscape(onClose);
  return <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 p-4 pt-[18vh]" onClick={onClose} role="presentation">
    <div role="dialog" aria-modal="true" aria-label="Calendar shortcuts" onClick={(event) => event.stopPropagation()} className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Calendar shortcuts</h3>
        <button ref={close} type="button" aria-label="Close" onClick={onClose} className="px-1 text-muted-foreground hover:text-foreground">×</button>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        {SHORTCUTS.filter(([key]) => views || !key.startsWith("Y")).map(([key, label]) => <div key={key} className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-mono text-xs">{key}</dd>
        </div>)}
      </dl>
    </div>
  </div>;
}

export function useHiddenKinds() {
  const key = "mi.calendar.kinds";
  const [hiddenKinds, setHiddenKinds] = useState<ScheduleKind[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe read of a per-viewer preference
      if (Array.isArray(saved)) setHiddenKinds(saved.filter((kind) => SCHEDULE_KINDS.includes(kind)));
    } catch { /* A blocked or malformed preference leaves every kind showing. */ }
  }, []);
  function toggleKind(kind: ScheduleKind) {
    const next = hiddenKinds.includes(kind) ? hiddenKinds.filter((entry) => entry !== kind) : [...hiddenKinds, kind];
    setHiddenKinds(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Not remembered this time. */ }
  }
  return { hiddenKinds, toggleKind };
}

export function CalendarKindFilter({ hiddenKinds, onToggle }: { hiddenKinds: ScheduleKind[]; onToggle: (kind: ScheduleKind) => void }) {
  return <div className="mt-2 flex flex-wrap justify-center gap-2" role="group" aria-label="Show on calendar">
    {SCHEDULE_KINDS.map((kind) => {
      const on = !hiddenKinds.includes(kind);
      return <button key={kind} type="button" aria-pressed={on} onClick={() => onToggle(kind)} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${on ? "border-border" : "border-dashed border-border text-muted-foreground opacity-60"}`}>
        <ScheduleKindMark kind={kind} />{KIND_LABEL[kind]}
      </button>;
    })}
  </div>;
}

/** Where the current minute falls in a span, refreshed each minute. */
export function useNowMinutes(): number {
  const [minutes, setMinutes] = useState(() => { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); });
  useEffect(() => {
    const timer = window.setInterval(() => { const now = new Date(); setMinutes(now.getHours() * 60 + now.getMinutes()); }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return minutes;
}

export function NowLine({ top }: { top: string }) {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-status-danger-foreground" style={{ top }}>
    <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-status-danger-foreground" />
  </div>;
}
