"use client";

import { useMemo, useState } from "react";
import type { Milestone } from "@/lib/schema";
import { hasMiDragKind, readMiDragData, setMiDragData } from "./miDragData";
import {
  moveScheduleAnchor,
  scheduleDateKey,
  scheduleViewHeading,
  scheduleVisibleDays,
  type ScheduleCalendarView,
} from "./scheduleCalendarModel";

export function ProjectMilestoneCalendar({
  milestones,
  onMove,
  onSelect,
}: {
  milestones: Milestone[];
  onMove: (milestone: Milestone, newDate: string) => void;
  onSelect: (milestone: Milestone) => void;
}) {
  const today = new Date();
  const [anchor, setAnchor] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [view, setView] = useState<ScheduleCalendarView>("month");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropDate, setDropDate] = useState<string | null>(null);
  const days = useMemo(() => scheduleVisibleDays(anchor, view), [anchor, view]);
  const byDate = useMemo(() => {
    const result = new Map<string, Milestone[]>();
    for (const milestone of milestones) {
      const key = milestone.planned_date.slice(0, 10);
      result.set(key, [...(result.get(key) ?? []), milestone]);
    }
    return result;
  }, [milestones]);
  const todayKey = scheduleDateKey(today);
  const columns = view === "month" ? 7 : days.length;

  function drop(newDate: string, milestoneId = draggingId) {
    const milestone = milestones.find((entry) => entry.id === milestoneId);
    setDraggingId(null);
    setDropDate(null);
    if (milestone && milestone.planned_date.slice(0, 10) !== newDate) onMove(milestone, newDate);
  }

  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Milestone calendar</h2>
          <p className="text-xs text-muted-foreground">Drag a milestone to draft a new planned date. Mi asks for confirmation before saving locally or to Notion.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setAnchor((current) => moveScheduleAnchor(current, view, -1))} className="rounded-md border border-border px-2.5 py-1.5 text-xs">Previous</button>
          <button type="button" onClick={() => setAnchor(new Date(today.getFullYear(), today.getMonth(), today.getDate()))} className="rounded-md border border-border px-2.5 py-1.5 text-xs">Today</button>
          <button type="button" onClick={() => setAnchor((current) => moveScheduleAnchor(current, view, 1))} className="rounded-md border border-border px-2.5 py-1.5 text-xs">Next</button>
          <div className="inline-flex rounded-md border border-border p-1" aria-label="Milestone calendar view">
            {(["month", "week", "work-week", "day"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                aria-pressed={view === option}
                className={`rounded px-2 py-1 text-[11px] capitalize ${view === option ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
              >
                {option === "work-week" ? "Work week" : option}
              </button>
            ))}
          </div>
        </div>
      </div>
      <h3 className="mt-3 text-center text-sm font-medium">{scheduleViewHeading(anchor, view)}</h3>
      <div className="mt-3 grid border-l border-t border-border" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {(view === "month" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : days.map((date) => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date))).map((label, index) => (
          <div key={`${label}-${index}`} className="border-b border-r border-border p-2 text-center text-[11px] font-medium text-muted-foreground">{label}</div>
        ))}
        {days.map((date) => {
          const key = scheduleDateKey(date);
          const entries = byDate.get(key) ?? [];
          const inMonth = date.getMonth() === anchor.getMonth();
          return (
            <div
              key={key}
              onDragEnter={(event) => {
                if (hasMiDragKind(event.dataTransfer, "project-milestone")) setDropDate(key);
              }}
              onDragOver={(event) => {
                if (!hasMiDragKind(event.dataTransfer, "project-milestone")) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropDate(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const payload = readMiDragData(event.dataTransfer);
                if (payload?.kind === "project-milestone") drop(key, payload.id);
              }}
              className={`border-b border-r border-border p-1.5 transition-colors ${view === "month" ? "min-h-24" : "min-h-40"} ${view === "month" && !inMonth ? "bg-muted/30" : "bg-background"} ${dropDate === key ? "relative z-10 bg-accent/15 ring-2 ring-inset ring-accent" : ""}`}
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${key === todayKey ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}>{date.getDate()}</span>
              <div className="mt-1 space-y-1">
                {entries.map((milestone) => (
                  <button
                    key={milestone.id}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      setMiDragData(event.dataTransfer, { kind: "project-milestone", id: milestone.id, mode: "move" });
                      setDraggingId(milestone.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropDate(null);
                    }}
                    onClick={() => onSelect(milestone)}
                    title={`${milestone.name} · Drag to reschedule or click to open the timeline editor`}
                    className={`block w-full cursor-grab rounded bg-muted px-1.5 py-1 text-left text-[10px] hover:bg-accent/20 active:cursor-grabbing ${milestone.actual_date ? "line-through opacity-60" : ""}`}
                  >
                    {milestone.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
