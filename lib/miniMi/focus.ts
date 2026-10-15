"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
const KEY = "mi-companion-focus-v1";
const EVENT = "mi-companion-focus-changed";
export interface FocusSession { phase: "focus" | "break"; endsAt: number; minutes: number }
export function parseFocus(raw: string | null): FocusSession | null {
  try { const v = JSON.parse(raw ?? "null"); return v && ["focus", "break"].includes(v.phase) && Number.isFinite(v.endsAt) && v.endsAt > 0 && Number.isFinite(v.minutes) && v.minutes >= 1 && v.minutes <= 120 ? v : null; }
  catch { return null; }
}
function snapshot() { try { return window.localStorage.getItem(KEY); } catch { return null; } }
function subscribe(fn: () => void) { window.addEventListener("storage", fn); window.addEventListener(EVENT, fn); return () => { window.removeEventListener("storage", fn); window.removeEventListener(EVENT, fn); }; }
export function setFocus(session: FocusSession | null): boolean {
  try { if (session) window.localStorage.setItem(KEY, JSON.stringify(session)); else window.localStorage.removeItem(KEY); window.dispatchEvent(new Event(EVENT)); return true; }
  catch { return false; }
}
export function useFocusSession() { return parseFocus(useSyncExternalStore(subscribe, snapshot, () => null)); }
export function useCompanionClock(active: boolean) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const initial = setTimeout(tick, 0);
    const timer = active ? setInterval(tick, 1000) : undefined;
    return () => { clearTimeout(initial); if (timer) clearInterval(timer); };
  }, [active]);
  return now;
}
