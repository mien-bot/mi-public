"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { ScheduleCalendarView } from "./scheduleCalendarModel";

export interface CalendarKeyActions {
  add: () => void;
  today: () => void;
  move: (offset: -1 | 1) => void;
  view?: (view: ScheduleCalendarView) => void;
}

export const CALENDAR_VIEW_KEYS: Record<string, ScheduleCalendarView> = { y: "year", m: "month", w: "week", r: "work-week", d: "day" };

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest?.("input, textarea, select, [contenteditable='true'], .xterm"));
}

/**
 * The same keys on every calendar. Studio stays mounted behind other surfaces, so a hidden
 * calendar ignores them, and an open dialog or a text field keeps its own keys.
 */
export function useCalendarKeys(root: RefObject<HTMLElement | null>, actions: CalendarKeyActions) {
  const [helpOpen, setHelpOpen] = useState(false);
  const latest = useRef(actions);
  useEffect(() => { latest.current = actions; });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (!root.current || root.current.offsetParent === null) return;
      if (document.querySelector("[aria-modal='true']")) return;
      const key = event.key.toLowerCase();
      const current = latest.current;
      const nextView = current.view ? CALENDAR_VIEW_KEYS[key] : undefined;
      if (key === "c") current.add();
      else if (key === "t") current.today();
      else if (key === "arrowleft" || key === "k") current.move(-1);
      else if (key === "arrowright" || key === "j") current.move(1);
      else if (key === "?") setHelpOpen(true);
      else if (nextView) current.view?.(nextView);
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root]);

  return { helpOpen, setHelpOpen };
}
