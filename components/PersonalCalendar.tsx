"use client";

import { useMemo, useState } from "react";
import { NotionLink } from "@/components/NotionLink";
import type { PersonalRecord } from "@/lib/personal/schema";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Personal scheduling only. Journal streaks deliberately live in the dedicated Journal view,
 * so a calendar cell communicates one thing: what is scheduled that day.
 */
export function PersonalCalendar({
  records,
  onCreatePlan,
  onReviewSchedule,
}: {
  records: PersonalRecord[];
  onCreatePlan: (date: string) => void;
  onReviewSchedule: (record: PersonalRecord) => void;
}) {
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const scheduled = records.filter((record) => record.schedule);
  const entries = useMemo(() => {
    const map = new Map<string, PersonalRecord[]>();
    scheduled.forEach((record) => {
      const key = record.schedule!.date;
      map.set(key, [...(map.get(key) ?? []), record]);
    });
    return map;
  }, [scheduled]);
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [month]);

  function changeMonth(offset: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-light">Personal calendar</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Scheduled to-dos and calendar items. Open an item to review its public fields before an optional confirmed calendar share.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => changeMonth(-1)} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent">Previous</button>
          <button type="button" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent">Today</button>
          <button type="button" onClick={() => changeMonth(1)} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent">Next</button>
        </div>
      </div>
      <h3 className="mt-4 text-center font-medium">{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month)}</h3>
      <div className="mt-3 grid grid-cols-7 border-l border-t border-border text-center text-xs text-muted-foreground">
        {weekdays.map((day) => <div key={day} className="border-b border-r border-border p-2 font-medium">{day}</div>)}
        {days.map((date) => {
          const key = dateKey(date);
          const dayEntries = entries.get(key) ?? [];
          const currentMonth = date.getMonth() === month.getMonth();
          const isToday = key === dateKey(today);
          return (
            <div key={key} className={`min-h-28 border-b border-r border-border p-1.5 text-left ${currentMonth ? "bg-background" : "bg-muted/30 text-muted-foreground"}`}>
              <div className="flex items-center justify-between gap-1">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday ? "bg-accent text-accent-foreground" : ""}`}>{date.getDate()}</span>
                <span className="flex items-center gap-0.5">
                  {currentMonth && <button type="button" onClick={() => onCreatePlan(key)} aria-label={`Add a plan on ${key}`} className="px-1 text-sm text-muted-foreground hover:text-accent">+</button>}
                </span>
              </div>
              <div className="mt-1 space-y-1">
                {dayEntries.slice(0, 3).map((record) => {
                  const personalShare = record.personalCalendarShare ?? { status: "local" as const };
                  const reviewable = record.share.status === "local" || personalShare.status === "local";
                  if (reviewable) return (
                    <button key={record.id} type="button" onClick={() => onReviewSchedule(record)} className="block w-full truncate rounded bg-muted px-1.5 py-1 text-left text-[10px] text-foreground hover:bg-accent/20" title={`${record.schedule!.name} · Review calendar destinations`}>
                      {record.schedule!.name}
                    </button>
                  );
                  const notionUrl = record.share.status === "shared"
                    ? record.share.notionUrl
                    : personalShare.status === "shared" ? personalShare.notionUrl : null;
                  return notionUrl ? (
                    <NotionLink key={record.id} href={notionUrl} title={`${record.schedule!.name} · Shared`} className="block truncate rounded bg-accent/15 px-1.5 py-1 text-[10px] text-foreground hover:underline">
                      {record.schedule!.name} ↗
                    </NotionLink>
                  ) : (
                    <button key={record.id} type="button" onClick={() => onReviewSchedule(record)} className="block w-full truncate rounded bg-muted px-1.5 py-1 text-left text-[10px] text-foreground hover:bg-accent/20">
                      {record.schedule!.name}
                    </button>
                  );
                })}
                {dayEntries.length > 3 && <p className="px-1 text-[10px] text-muted-foreground">+{dayEntries.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-muted" />Local / reviewable</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-accent/40" />Shared to a calendar</span>
      </div>
    </section>
  );
}
