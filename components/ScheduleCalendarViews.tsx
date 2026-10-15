"use client";

import { useState } from "react";
import type { ScheduleSnapshotEntry } from "@/types/electron";
import { hasMiDragKind, readMiDragData, setMiDragData } from "./miDragData";
import {
  canDragScheduleEntry,
  scheduleDateKey,
  type ScheduleCalendarView,
  type ScheduleDragMode,
} from "./scheduleCalendarModel";

const DAY_START_MINUTES = 6 * 60;
const DAY_END_MINUTES = 22 * 60;
const PROJECT_EVENT_COLORS = [
  "var(--viz-series-1)",
  "var(--viz-series-2)",
  "var(--viz-series-3)",
  "var(--viz-series-4)",
  "var(--viz-series-6)",
] as const;

/** A relation ID is already human-confirmed in Notion. Hash only that opaque ID so a project
 * keeps the same color without guessing a link, name, or category. Unlinked entries stay neutral. */
export function scheduleEntryColor(entry: Pick<ScheduleSnapshotEntry, "project_page_ids">): string {
  const projectId = [...entry.project_page_ids].sort()[0];
  if (!projectId) return "var(--muted-foreground)";
  let hash = 0;
  for (const character of projectId) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return PROJECT_EVENT_COLORS[hash % PROJECT_EVENT_COLORS.length];
}

function eventTimeLabel(entry: ScheduleSnapshotEntry, timezone: string): string | null {
  if (!entry.date?.includes("T")) return null;
  const start = new Date(entry.date);
  if (Number.isNaN(start.getTime())) return null;
  const formatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: timezone });
  const startLabel = formatter.format(start);
  if (!entry.date_end) return startLabel;
  const end = new Date(entry.date_end);
  return Number.isNaN(end.getTime()) ? startLabel : `${startLabel}–${formatter.format(end)}`;
}

function minutesInDay(value: string, timezone: string): number | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

function timedPosition(entry: ScheduleSnapshotEntry, timezone: string, previewEndMinutes?: number): { top: string; height: string } {
  const start = entry.date?.includes("T") ? minutesInDay(entry.date, timezone) : null;
  const parsedStart = entry.date?.includes("T") ? Date.parse(entry.date) : Number.NaN;
  const parsedEnd = entry.date_end ? Date.parse(entry.date_end) : Number.NaN;
  const duration = Number.isFinite(parsedStart) && Number.isFinite(parsedEnd) && parsedEnd > parsedStart
    ? (parsedEnd - parsedStart) / 60_000
    : 60;
  const range = DAY_END_MINUTES - DAY_START_MINUTES;
  const clampedStart = Math.min(DAY_END_MINUTES, Math.max(DAY_START_MINUTES, start ?? DAY_START_MINUTES));
  const clampedEnd = Math.min(
    DAY_END_MINUTES,
    Math.max(clampedStart + 30, previewEndMinutes ?? clampedStart + duration),
  );
  return {
    top: `${((clampedStart - DAY_START_MINUTES) / range) * 100}%`,
    height: `${Math.max(3.5, ((clampedEnd - clampedStart) / range) * 100)}%`,
  };
}

function EntryButton({
  entry,
  onOpen,
  onDragStart,
  onDragEnd,
  timezone,
  compact = false,
  saving = false,
}: {
  entry: ScheduleSnapshotEntry;
  onOpen: (entry: ScheduleSnapshotEntry) => void;
  onDragStart: (entry: ScheduleSnapshotEntry, mode: ScheduleDragMode) => void;
  onDragEnd: () => void;
  timezone: string;
  compact?: boolean;
  saving?: boolean;
}) {
  const time = eventTimeLabel(entry, timezone);
  const draggable = canDragScheduleEntry(entry) && !saving;
  const dragNote = draggable ? (time ? "Drag to move; Ctrl-drag to duplicate; use the bottom handle to resize" : "Drag to move; Ctrl-drag to duplicate") : "Open in Notion";
  const eventColor = scheduleEntryColor(entry);
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(event) => {
        const mode: ScheduleDragMode = event.ctrlKey || event.metaKey ? "duplicate" : "move";
        setMiDragData(event.dataTransfer, { kind: "schedule-entry", id: entry.notion_page_id, mode });
        onDragStart(entry, mode);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(entry)}
      aria-busy={saving}
      className={`block h-full w-full overflow-hidden rounded border-l-[3px] px-1.5 py-1 text-left text-foreground hover:brightness-110 ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${saving ? "cursor-wait opacity-60" : ""} ${compact ? "truncate text-[10px]" : "text-xs"}`}
      style={{
        borderLeftColor: eventColor,
        background: `color-mix(in srgb, ${eventColor} 20%, var(--background))`,
      }}
      title={`${time ? `${time} · ` : ""}${entry.name} · ${dragNote}`}
    >
      {time && <span className="mr-1 font-medium">{time}</span>}
      {entry.name} ↗
    </button>
  );
}

export function MonthScheduleView({
  days,
  anchor,
  todayKey,
  entriesByDate,
  onOpen,
  onDragStart,
  onDragEnd,
  onDrop,
  onCreate,
  timezone,
  savingEntryId,
}: {
  days: Date[];
  anchor: Date;
  todayKey: string;
  entriesByDate: Map<string, ScheduleSnapshotEntry[]>;
  onOpen: (entry: ScheduleSnapshotEntry) => void;
  onDragStart: (entry: ScheduleSnapshotEntry, mode: ScheduleDragMode) => void;
  onDragEnd: () => void;
  onDrop: (date: string) => void;
  onCreate: (date: string) => void;
  timezone: string;
  savingEntryId?: string | null;
}) {
  const [dropDate, setDropDate] = useState<string | null>(null);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div className="mt-3 grid grid-cols-7 border-l border-t border-border text-center text-xs text-muted-foreground">
      {weekdays.map((day) => <div key={day} className="border-b border-r border-border p-2 font-medium">{day}</div>)}
      {days.map((date) => {
        const key = scheduleDateKey(date);
        const dayEntries = entriesByDate.get(key) ?? [];
        const currentMonth = date.getMonth() === anchor.getMonth();
        return (
          <div
            key={key}
            onDragEnter={(event) => {
              if (hasMiDragKind(event.dataTransfer, "schedule-entry")) setDropDate(key);
            }}
            onDragOver={(event) => {
              if (!hasMiDragKind(event.dataTransfer, "schedule-entry")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? "copy" : "move";
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropDate(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const payload = readMiDragData(event.dataTransfer);
              setDropDate(null);
              if (payload?.kind === "schedule-entry") onDrop(key);
            }}
            className={`min-h-28 border-b border-r p-1.5 text-left transition-colors ${dropDate === key ? "border-accent bg-accent/15 ring-2 ring-inset ring-accent/40" : "border-border"} ${currentMonth ? "bg-background" : "bg-muted/30 text-muted-foreground"}`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${key === todayKey ? "bg-accent text-accent-foreground" : ""}`}>{date.getDate()}</span>
              <button
                type="button"
                onClick={() => onCreate(key)}
                aria-label={`Add event on ${key}`}
                title={`Add an event on ${key}`}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-sm font-medium text-foreground hover:border-accent hover:bg-accent hover:text-accent-foreground"
              >
                +
              </button>
            </div>
            <div className="mt-1 space-y-1">
              {dayEntries.slice(0, 3).map((entry) => (
                <EntryButton key={entry.notion_page_id} entry={entry} onOpen={onOpen} onDragStart={onDragStart} onDragEnd={onDragEnd} timezone={timezone} compact saving={savingEntryId === entry.notion_page_id} />
              ))}
              {dayEntries.length > 3 && <p className="px-1 text-[10px] text-muted-foreground">+{dayEntries.length - 3} more</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TimedScheduleView({
  view,
  days,
  todayKey,
  entriesByDate,
  onOpen,
  onDragStart,
  onDragEnd,
  onDrop,
  onCreate,
  timezone,
  savingEntryId,
  dragging,
}: {
  view: Exclude<ScheduleCalendarView, "month">;
  days: Date[];
  todayKey: string;
  entriesByDate: Map<string, ScheduleSnapshotEntry[]>;
  onOpen: (entry: ScheduleSnapshotEntry) => void;
  onDragStart: (entry: ScheduleSnapshotEntry, mode: ScheduleDragMode) => void;
  onDragEnd: () => void;
  onDrop: (date: string, targetMinutes: number) => void;
  onCreate: (date: string) => void;
  timezone: string;
  savingEntryId?: string | null;
  dragging?: { entry: ScheduleSnapshotEntry; mode: ScheduleDragMode } | null;
}) {
  const [dropDate, setDropDate] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ date: string; minutes: number } | null>(null);
  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-border">
      <div className="grid min-w-[48rem]" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="border-b border-r border-border bg-card" aria-hidden="true" />
        {days.map((date) => {
          const key = scheduleDateKey(date);
          return (
            <div key={key} className={`relative border-r border-border p-2 text-center last:border-r-0 ${key === todayKey ? "bg-accent/10" : "bg-card"}`}>
              <div className="text-xs font-medium">{new Intl.DateTimeFormat(undefined, { weekday: view === "day" ? "long" : "short" }).format(date)}</div>
              <div className="text-sm">{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)}</div>
              <button
                type="button"
                onClick={() => onCreate(key)}
                aria-label={`Add event on ${key}`}
                title={`Add an event on ${key}`}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-sm font-medium text-foreground hover:border-accent hover:bg-accent hover:text-accent-foreground"
              >
                +
              </button>
            </div>
          );
        })}
        <div className="relative min-h-[48rem] border-r border-t border-border bg-card text-[10px] text-muted-foreground" aria-hidden="true">
          {Array.from({ length: 16 }, (_, index) => index + 6).map((hour, index) => (
            <span key={hour} className="absolute right-1 -translate-y-1/2" style={{ top: `${(index / 16) * 100}%` }}>
              {new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2026, 0, 1, hour))}
            </span>
          ))}
        </div>
        {days.map((date) => {
          const key = scheduleDateKey(date);
          const entries = entriesByDate.get(key) ?? [];
          const untimed = entries.filter((entry) => !entry.date?.includes("T"));
          const timed = entries.filter((entry) => entry.date?.includes("T"));
          return (
            <div
              key={`events-${key}`}
              onDragEnter={(event) => {
                if (hasMiDragKind(event.dataTransfer, "schedule-entry")) setDropDate(key);
              }}
              onDragOver={(event) => {
                if (!hasMiDragKind(event.dataTransfer, "schedule-entry")) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? "copy" : "move";
                const bounds = event.currentTarget.getBoundingClientRect();
                const fraction = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
                const rawMinutes = DAY_START_MINUTES + fraction * (DAY_END_MINUTES - DAY_START_MINUTES);
                const minutes = Math.round(rawMinutes / 15) * 15;
                setDropTarget((current) => current?.date === key && current.minutes === minutes
                  ? current
                  : { date: key, minutes });
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropDate(null);
                  setDropTarget(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const payload = readMiDragData(event.dataTransfer);
                setDropDate(null);
                setDropTarget(null);
                if (payload?.kind !== "schedule-entry") return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const fraction = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
                const rawMinutes = DAY_START_MINUTES + fraction * (DAY_END_MINUTES - DAY_START_MINUTES);
                const snappedMinutes = Math.round(rawMinutes / 15) * 15;
                onDrop(key, snappedMinutes);
              }}
              className={`relative min-h-[48rem] border-r border-t bg-background transition-colors last:border-r-0 ${dropDate === key ? "border-accent bg-accent/10 ring-2 ring-inset ring-accent/40" : "border-border"}`}
              style={{
                backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent calc(6.25% - 1px), color-mix(in srgb, var(--border) 55%, transparent) calc(6.25% - 1px), color-mix(in srgb, var(--border) 55%, transparent) 6.25%)",
              }}
            >
              {untimed.length > 0 && (
                <div className="relative z-10 space-y-1 border-b border-border bg-card/95 p-1.5">
                  {untimed.map((entry) => <EntryButton key={entry.notion_page_id} entry={entry} onOpen={onOpen} onDragStart={onDragStart} onDragEnd={onDragEnd} timezone={timezone} compact saving={savingEntryId === entry.notion_page_id} />)}
                </div>
              )}
              {timed.map((entry) => {
                const previewingResize = dragging?.mode === "resize"
                  && dragging.entry.notion_page_id === entry.notion_page_id
                  && dropTarget?.date === key;
                return (
                  <div
                    key={entry.notion_page_id}
                    className={`absolute left-1 right-1 z-10 min-h-7 transition-[height] ${previewingResize ? "ring-2 ring-accent ring-offset-1 ring-offset-background" : ""}`}
                    style={timedPosition(entry, timezone, previewingResize ? dropTarget?.minutes : undefined)}
                  >
                    <EntryButton entry={entry} onOpen={onOpen} onDragStart={onDragStart} onDragEnd={onDragEnd} timezone={timezone} compact={view !== "day"} saving={savingEntryId === entry.notion_page_id} />
                    {entry.date_end && (
                      <button
                        type="button"
                        draggable={savingEntryId !== entry.notion_page_id}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          setMiDragData(event.dataTransfer, { kind: "schedule-entry", id: entry.notion_page_id, mode: "resize" });
                          const eventBar = event.currentTarget.parentElement;
                          if (eventBar) {
                            event.dataTransfer.setDragImage(eventBar, eventBar.clientWidth / 2, Math.max(1, eventBar.clientHeight - 4));
                          }
                          onDragStart(entry, "resize");
                        }}
                        onDragEnd={() => {
                          setDropDate(null);
                          setDropTarget(null);
                          onDragEnd();
                        }}
                        aria-label={`Resize ${entry.name}`}
                        title="Drag to change the end time"
                        disabled={savingEntryId === entry.notion_page_id}
                        className="absolute inset-x-1 bottom-0 h-2 cursor-ns-resize rounded-sm border-b-2 border-current bg-background/25 opacity-70 hover:opacity-100 disabled:cursor-wait disabled:opacity-40"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
