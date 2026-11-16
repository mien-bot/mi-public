"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Milestone, ScheduleType } from "@/lib/schema";
import { CategoryPicker } from "./CategoryPicker";
import { compareTier, milestoneTier, scheduleKind, type TimelineRow } from "@/lib/scheduleInsights";
import { hasMiDragKind, readMiDragData, setMiDragData } from "./miDragData";
import { UpcomingCriticalStrip } from "./YearTimelineView";
import { CalendarKindFilter, CalendarShortcuts, NowLine, useEscape, useHiddenKinds, useNowMinutes } from "./CalendarParts";
import { useCalendarKeys } from "./useCalendarKeys";
import { KIND_CHIP, SCHEDULE_KINDS } from "./scheduleKindStyle";
import { YearMonthsView } from "./YearMonthsView";
import {
  moveScheduleAnchor,
  scheduleDateKey,
  scheduleViewHeading,
  scheduleVisibleDays,
  dateFromScheduleKey,
  type ScheduleCalendarView,
} from "./scheduleCalendarModel";

const MONTH_CHIP_LIMIT = 3;

const VIEWS: { value: ScheduleCalendarView; label: string; key: string }[] = [
  { value: "year", label: "Year", key: "Y" },
  { value: "month", label: "Month", key: "M" },
  { value: "week", label: "Week", key: "W" },
  { value: "work-week", label: "Work week", key: "R" },
  { value: "day", label: "Day", key: "D" },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
const hourTime = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export interface QuickAddItem {
  name: string;
  date: string;
  time: string;
  type: ScheduleType;
  toNotion: boolean;
}

export function ProjectMilestoneCalendar({
  milestones,
  onMove,
  onSelect,
  onQuickAdd,
  notionLinked,
  row,
}: {
  milestones: Milestone[];
  onMove: (milestone: Milestone, newDate: string, time?: string | null) => void;
  onSelect: (milestone: Milestone) => void;
  onQuickAdd: (item: QuickAddItem) => Promise<boolean>;
  notionLinked: boolean;
  row: TimelineRow;
}) {
  const today = new Date();
  const todayKey = scheduleDateKey(today);
  const [anchor, setAnchor] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [view, setView] = useState<ScheduleCalendarView>("month");
  const [, setDraggingId] = useState<string | null>(null);
  const [dropDate, setDropDate] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ date: string; time: string } | null>(null);
  const { hiddenKinds, toggleKind } = useHiddenKinds();
  const root = useRef<HTMLElement>(null);
  const shown = useMemo(() => milestones.filter((item) => !hiddenKinds.includes(scheduleKind(item))), [milestones, hiddenKinds]);
  const shownRow = useMemo(() => {
    const hidden = new Set(milestones.filter((item) => scheduleKind(item) !== "milestone").map((item) => item.id));
    return { ...row, markers: row.markers.filter((marker) => !hidden.has(marker.id)) };
  }, [milestones, row]);
  const yearMarkers = useMemo(() => shown.map((item) => ({
    date: item.planned_date, name: item.name, tier: milestoneTier(item), done: Boolean(item.actual_date), kind: scheduleKind(item),
  })), [shown]);
  const days = useMemo(() => scheduleVisibleDays(anchor, view), [anchor, view]);
  const byDate = useMemo(() => {
    const result = new Map<string, Milestone[]>();
    for (const milestone of shown) {
      const key = milestone.planned_date.slice(0, 10);
      result.set(key, [...(result.get(key) ?? []), milestone]);
    }
    for (const entries of result.values()) {
      entries.sort((a, b) => SCHEDULE_KINDS.indexOf(scheduleKind(a)) - SCHEDULE_KINDS.indexOf(scheduleKind(b))
        || compareTier(milestoneTier(a), milestoneTier(b)));
    }
    return result;
  }, [shown]);

  function defaultDate() {
    return view !== "year" && days.map(scheduleDateKey).includes(todayKey)
      ? todayKey
      : scheduleDateKey(view === "year" ? new Date() : anchor);
  }
  const { helpOpen, setHelpOpen } = useCalendarKeys(root, {
    add: () => setQuickAdd({ date: defaultDate(), time: "" }),
    today: () => { const now = new Date(); setAnchor(new Date(now.getFullYear(), now.getMonth(), now.getDate())); },
    move: (offset) => setAnchor((current) => moveScheduleAnchor(current, view, offset)),
    view: setView,
  });

  function drop(newDate: string, milestoneId: string | null, time?: string | null) {
    const milestone = shown.find((entry) => entry.id === milestoneId);
    setDraggingId(null);
    setDropDate(null);
    if (!milestone) return;
    const sameDay = milestone.planned_date.slice(0, 10) === newDate;
    if (sameDay && (time === undefined || time === (milestone.start_time ?? null))) return;
    onMove(milestone, newDate, time);
  }

  /** A month cell keeps an item's time, an hour sets it, and the all-day row clears it. */
  function dropTarget(key: string, time?: string | null) {
    return {
      onDragEnter: (event: React.DragEvent) => {
        if (hasMiDragKind(event.dataTransfer, "project-milestone")) setDropDate(key);
      },
      onDragOver: (event: React.DragEvent) => {
        if (!hasMiDragKind(event.dataTransfer, "project-milestone")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
      onDragLeave: (event: React.DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropDate(null);
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        const payload = readMiDragData(event.dataTransfer);
        if (payload?.kind === "project-milestone") drop(key, payload.id, time);
      },
    };
  }

  function openDay(key: string) {
    setAnchor(dateFromScheduleKey(key));
    setView("day");
  }

  function chips(entries: Milestone[], moreDay?: string) {
    const limit = moreDay ? MONTH_CHIP_LIMIT : entries.length;
    return <div className="mt-1 space-y-1">
      {entries.slice(0, limit).map((milestone) => (
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
          onClick={(event) => { event.stopPropagation(); onSelect(milestone); }}
          title={`${milestone.name} · Drag to reschedule or click for details`}
          className={`block w-full cursor-grab truncate px-1.5 py-1 text-left text-[11px] hover:bg-accent/20 active:cursor-grabbing ${KIND_CHIP[scheduleKind(milestone)]} ${milestoneTier(milestone) === "critical" ? "font-semibold" : ""} ${milestone.actual_date ? "line-through opacity-60" : ""}`}
        >
          {milestone.start_time && <span className="mr-1 tabular-nums opacity-70">{milestone.start_time}</span>}
          {milestone.name}
        </button>
      ))}
      {entries.length > limit && <button type="button" onClick={(event) => { event.stopPropagation(); openDay(moreDay as string); }} className="px-1.5 text-[11px] text-link hover:underline">+{entries.length - limit} more</button>}
    </div>;
  }

  const dropClass = (key: string) => dropDate === key ? "relative z-10 bg-accent/15 ring-2 ring-inset ring-accent" : "";

  return (
    <section ref={root} className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Calendar</h2>
          <p className="text-xs text-muted-foreground">Press C or click a day to add. Drag to move. Press ? for shortcuts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setQuickAdd({ date: defaultDate(), time: "" })} className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background">Add <kbd className="ml-1 opacity-60">C</kbd></button>
          <button type="button" onClick={() => setAnchor((current) => moveScheduleAnchor(current, view, -1))} aria-label="Previous" className="rounded-md border border-border px-2.5 py-1.5 text-xs">←</button>
          <button type="button" onClick={() => setAnchor(new Date(today.getFullYear(), today.getMonth(), today.getDate()))} className="rounded-md border border-border px-2.5 py-1.5 text-xs">Today</button>
          <button type="button" onClick={() => setAnchor((current) => moveScheduleAnchor(current, view, 1))} aria-label="Next" className="rounded-md border border-border px-2.5 py-1.5 text-xs">→</button>
          <div className="inline-flex rounded-md border border-border p-1" role="group" aria-label="Milestone calendar view">
            {VIEWS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setView(option.value)}
                aria-pressed={view === option.value}
                title={`Press ${option.key}`}
                className={`rounded px-2 py-1 text-[11px] ${view === option.value ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <UpcomingCriticalStrip rows={[shownRow]} today={todayKey} showProject={false} />
      <h3 className="mt-3 text-center text-sm font-medium">{scheduleViewHeading(anchor, view)}</h3>
      <CalendarKindFilter hiddenKinds={hiddenKinds} onToggle={toggleKind} />
      {view === "year" && <YearMonthsView
        year={anchor.getFullYear()}
        today={todayKey}
        markers={yearMarkers}
        onSelectDay={openDay}
      />}
      {view === "month" && <div className="mt-3 grid grid-cols-7 border-l border-t border-border">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
          <div key={label} className="border-b border-r border-border p-2 text-center text-[11px] font-medium text-muted-foreground">{label}</div>
        ))}
        {days.map((date) => {
          const key = scheduleDateKey(date);
          return <div
            key={key}
            {...dropTarget(key)}
            onClick={() => setQuickAdd({ date: key, time: "" })}
            aria-label={`Add on ${key}`}
            className={`min-h-24 cursor-pointer border-b border-r border-border p-1.5 transition-colors hover:bg-muted/40 ${date.getMonth() === anchor.getMonth() ? "bg-background" : "bg-muted/30"} ${dropClass(key)}`}
          >
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${key === todayKey ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}>{date.getDate()}</span>
            {chips(byDate.get(key) ?? [], key)}
          </div>;
        })}
      </div>}
      {view !== "year" && view !== "month" && <HourGrid
        days={days}
        todayKey={todayKey}
        renderAllDay={(key) => chips((byDate.get(key) ?? []).filter((item) => !item.start_time))}
        renderHour={(key, hour) => chips((byDate.get(key) ?? []).filter((item) => item.start_time?.slice(0, 2) === hourTime(hour).slice(0, 2)))}
        dropTarget={dropTarget}
        dropClass={dropClass}
        onPick={(date, time) => setQuickAdd({ date, time })}
      />}
      {helpOpen && <CalendarShortcuts onClose={() => setHelpOpen(false)} />}
      {quickAdd && <QuickAddPanel
        key={`${quickAdd.date}-${quickAdd.time}`}
        date={quickAdd.date}
        time={quickAdd.time}
        notionLinked={notionLinked}
        onClose={() => setQuickAdd(null)}
        onSubmit={onQuickAdd}
      />}
    </section>
  );
}

function HourGrid({ days, todayKey, renderAllDay, renderHour, dropTarget, dropClass, onPick }: {
  days: Date[];
  todayKey: string;
  renderAllDay: (key: string) => React.ReactNode;
  renderHour: (key: string, hour: number) => React.ReactNode;
  dropTarget: (key: string, time?: string | null) => React.HTMLAttributes<HTMLDivElement>;
  dropClass: (key: string) => string;
  onPick: (date: string, time: string) => void;
}) {
  const nowMinutes = useNowMinutes();
  const scroller = useRef<HTMLDivElement>(null);
  const firstWorkHour = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current && firstWorkHour.current) scroller.current.scrollTop = firstWorkHour.current.offsetTop - 40;
  }, []);
  const columns = { gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` };
  return <div className="mt-3 overflow-hidden rounded-md border border-border">
    <div className="grid border-b border-border" style={columns}>
      <div className="border-r border-border p-1 text-right text-[10px] text-muted-foreground">All day</div>
      {days.map((date) => {
        const key = scheduleDateKey(date);
        return <div key={key} {...dropTarget(key, null)} onClick={() => onPick(key, "")} className={`min-h-16 cursor-pointer border-r border-border p-1.5 last:border-r-0 hover:bg-muted/40 ${dropClass(key)}`}>
          <p className="text-center text-[11px] text-muted-foreground">
            {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}{" "}
            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${key === todayKey ? "bg-accent text-accent-foreground" : ""}`}>{date.getDate()}</span>
          </p>
          {renderAllDay(key)}
        </div>;
      })}
    </div>
    <div ref={scroller} className="relative max-h-[32rem] overflow-y-auto">
      {HOURS.map((hour) => <div key={hour} ref={hour === 7 ? firstWorkHour : undefined} className="grid border-b border-border/60 last:border-b-0" style={columns}>
        <div className="border-r border-border pr-1.5 pt-0.5 text-right text-[10px] tabular-nums text-muted-foreground">{hourLabel(hour)}</div>
        {days.map((date) => {
          const key = scheduleDateKey(date);
          return <div
            key={key}
            {...dropTarget(key, hourTime(hour))}
            onClick={() => onPick(key, hourTime(hour))}
            aria-label={`Add at ${hourLabel(hour)} on ${key}`}
            className={`relative min-h-10 cursor-pointer border-r border-border/60 px-1 last:border-r-0 hover:bg-muted/40 ${dropClass(key)}`}
          >
            {key === todayKey && Math.floor(nowMinutes / 60) === hour && <NowLine top={`${((nowMinutes % 60) / 60) * 100}%`} />}
            {renderHour(key, hour)}
          </div>;
        })}
      </div>)}
    </div>
  </div>;
}

function QuickAddPanel({ date, time, notionLinked, onClose, onSubmit }: {
  date: string;
  time: string;
  notionLinked: boolean;
  onClose: () => void;
  onSubmit: (item: QuickAddItem) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [day, setDay] = useState(date);
  const [at, setAt] = useState(time);
  // A time usually means a meeting; a bare date usually means something is due.
  const [type, setType] = useState<ScheduleType>(time ? "Meeting" : "Deadline");
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  async function submit(toNotion: boolean) {
    if (!name.trim() || !day) return;
    setBusy(true);
    const added = await onSubmit({ name: name.trim(), date: day, time: at, type, toNotion });
    setBusy(false);
    if (added) onClose();
  }

  return <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 p-4 pt-[18vh]" onClick={onClose} role="presentation">
    <form
      role="dialog"
      aria-modal="true"
      aria-label="Add to schedule"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => { event.preventDefault(); void submit(false); }}
      className="w-full max-w-lg space-y-3 rounded-lg border border-border bg-card p-4 shadow-xl"
    >
      <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Add a title" aria-label="Title" maxLength={200} required className="w-full bg-transparent text-base font-medium outline-none" />
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input type="date" value={day} onChange={(event) => setDay(event.target.value)} aria-label="Date" required className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
        <input type="time" value={at} onChange={(event) => setAt(event.target.value)} aria-label="Time, optional" className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
      </div>
      <CategoryPicker value={type} onChange={setType} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
        {notionLinked && <button type="button" disabled={busy || !name.trim()} onClick={() => void submit(true)} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40">Add to Mi + Notion…</button>}
        <button type="submit" disabled={busy || !name.trim()} className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-40">{busy ? "Saving…" : "Save to Mi"}</button>
      </div>
    </form>
  </div>;
}
