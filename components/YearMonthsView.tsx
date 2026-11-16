"use client";

import type { ScheduleKind, ScheduleTier } from "@/lib/scheduleInsights";
import { compareTier } from "@/lib/scheduleInsights";
import { scheduleDateKey } from "./scheduleCalendarModel";
import { KIND_DAY, SCHEDULE_KINDS } from "./scheduleKindStyle";

export interface YearMonthsMarker {
  date: string;
  name: string;
  tier: ScheduleTier;
  done: boolean;
  /** Fills the day by kind instead of tier. */
  kind?: ScheduleKind;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const DAY_TIER: Record<ScheduleTier, string> = {
  critical: "bg-accent font-semibold text-accent-foreground",
  high: "bg-accent/30 font-medium text-foreground",
  normal: "bg-muted font-medium text-foreground",
  low: "bg-muted/60 text-foreground",
};

/** All twelve months as small date grids. A day with something on it is filled by its top tier. */
export function YearMonthsView({ year, today, markers, onSelectDay }: {
  year: number;
  today: string;
  markers: YearMonthsMarker[];
  onSelectDay: (date: string) => void;
}) {
  const byDate = new Map<string, YearMonthsMarker[]>();
  for (const marker of markers) {
    const key = marker.date.slice(0, 10);
    byDate.set(key, [...(byDate.get(key) ?? []), marker]);
  }
  return <div className="mt-3 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {Array.from({ length: 12 }, (_, month) => {
      const first = new Date(year, month, 1);
      const length = new Date(year, month + 1, 0).getDate();
      return <section key={month} aria-label={new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(first)}>
        <h4 className="px-1 text-xs font-medium">{new Intl.DateTimeFormat(undefined, { month: "long" }).format(first)}</h4>
        <div className="mt-1 grid grid-cols-7 text-center text-[10px] text-muted-foreground" aria-hidden="true">
          {WEEKDAYS.map((label, index) => <span key={index}>{label}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5">
          {Array.from({ length: first.getDay() }, (_, index) => <span key={`blank-${index}`} />)}
          {Array.from({ length }, (_, index) => {
            const key = scheduleDateKey(new Date(year, month, index + 1));
            const entries = [...(byDate.get(key) ?? [])].sort((a, b) => SCHEDULE_KINDS.indexOf(a.kind ?? "milestone") - SCHEDULE_KINDS.indexOf(b.kind ?? "milestone") || compareTier(a.tier, b.tier));
            const top = entries.find((entry) => !entry.done) ?? entries[0];
            const summary = entries.map((entry) => `${entry.name}${entry.done ? " (done)" : ""}`).join("\n");
            return <button
              key={key}
              type="button"
              onClick={() => onSelectDay(key)}
              title={summary || undefined}
              aria-label={`${key}${summary ? `: ${entries.map((entry) => entry.name).join(", ")}` : ""}`}
              className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[10px] tabular-nums hover:ring-1 hover:ring-accent ${top ? (top.kind ? KIND_DAY[top.kind] : DAY_TIER[top.tier]) : "text-muted-foreground"} ${top?.done ? "opacity-50" : ""} ${key === today ? "ring-2 ring-foreground" : ""}`}
            >
              {index + 1}
            </button>;
          })}
        </div>
      </section>;
    })}
  </div>;
}
