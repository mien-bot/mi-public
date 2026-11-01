"use client";

import Link from "next/link";
import { upcomingMarkers, type ScheduleTier, type TimelineMarker, type TimelineRow } from "@/lib/scheduleInsights";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

function yearPosition(date: string, year: number): number {
  const start = Date.UTC(year, 0, 1);
  const length = Date.UTC(year + 1, 0, 1) - start;
  const value = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Math.min(100, Math.max(0, ((value - start) / length) * 100));
}

const MARKER_STYLE: Record<ScheduleTier, string> = {
  critical: "h-3.5 w-3.5 rotate-45 bg-accent ring-2 ring-background",
  high: "h-2.5 w-2.5 rotate-45 border-2 border-accent bg-background",
  normal: "h-2 w-2 rounded-full bg-muted-foreground",
  low: "h-1.5 w-1.5 rounded-full bg-muted-foreground/60",
};

function Marker({ marker, year }: { marker: TimelineMarker; year: number }) {
  return <span
    title={`${marker.date} · ${marker.name}${marker.done ? " · done" : ""}`}
    aria-label={`${marker.name}, ${marker.date}`}
    role="img"
    style={{ left: `${yearPosition(marker.date, year)}%` }}
    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 ${MARKER_STYLE[marker.tier]} ${marker.done ? "opacity-35" : ""}`}
  />;
}

/** One row per project across twelve months, so the whole year reads at a glance. */
export function YearTimelineView({ rows, year, today }: { rows: TimelineRow[]; year: number; today: string }) {
  const showToday = today.startsWith(String(year));
  return <div className="mt-3 overflow-x-auto rounded-md border border-border">
    <div className="min-w-[48rem]">
      <div className="grid grid-cols-[11rem_1fr] border-b border-border text-[11px] font-medium text-muted-foreground">
        <div className="p-2">Project</div>
        <div className="grid grid-cols-12">{MONTHS.map((month) => <div key={month} className="border-l border-border p-2 text-center">{month}</div>)}</div>
      </div>
      {rows.map((row) => <div key={row.slug} className="grid grid-cols-[11rem_1fr] border-b border-border last:border-b-0">
        <Link href={`/projects/${row.slug}/schedule`} className="truncate p-2 text-xs hover:underline" title={row.name}>{row.name}</Link>
        <div className="relative min-h-11">
          <div aria-hidden="true" className="absolute inset-0 grid grid-cols-12">{MONTHS.map((month) => <div key={month} className="border-l border-border/60" />)}</div>
          {showToday && <div aria-hidden="true" className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: `${yearPosition(today, year)}%` }} />}
          {row.phases.map((phase) => {
            const left = yearPosition(phase.start, year);
            const width = Math.max(0.5, yearPosition(phase.end, year) + (100 * DAY_MS) / (365 * DAY_MS) - left);
            return <div key={phase.id} title={`${phase.name} · ${phase.start} to ${phase.end}${phase.progress === null ? "" : ` · ${phase.progress}%`}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              className="absolute top-1/2 h-4 -translate-y-1/2 overflow-hidden rounded-sm bg-accent/15 text-[9px] leading-4 text-muted-foreground">
              {phase.progress !== null && <div aria-hidden="true" className="absolute inset-y-0 left-0 bg-accent/30" style={{ width: `${phase.progress}%` }} />}
              <span className="relative px-1">{phase.name}{phase.progress === null ? "" : ` ${phase.progress}%`}</span>
            </div>;
          })}
          {row.markers.filter((marker) => marker.date.startsWith(String(year))).map((marker) => <Marker key={marker.id} marker={marker} year={year} />)}
        </div>
      </div>)}
      {rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No dated project milestones in {year}.</p>}
    </div>
  </div>;
}

export function TierLegend() {
  return <p className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
    <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rotate-45 bg-accent" />Critical</span>
    <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rotate-45 border-2 border-accent" />High</span>
    <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" />Everything else</span>
  </p>;
}

/** The dates that matter most, above the calendar, so they can't be lost among meetings. */
export function UpcomingCriticalStrip({ rows, today, showProject = true }: { rows: TimelineRow[]; today: string; showProject?: boolean }) {
  const items = upcomingMarkers(rows, today).slice(0, 8);
  if (!items.length) return null;
  return <section aria-label="Upcoming critical dates" className="mt-3 rounded-md border border-accent/40 bg-accent/5 p-3">
    <h3 className="text-xs font-medium">Coming up in the next 60 days</h3>
    <ul className="mt-1.5 grid gap-1 text-xs sm:grid-cols-2">
      {items.map((item) => <li key={`${item.slug}-${item.id}`} className="flex min-w-0 gap-2">
        <span className={`shrink-0 tabular-nums ${item.date < today ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{item.date.slice(5)}{item.date < today ? " overdue" : ""}</span>
        <span className={`truncate ${item.tier === "critical" ? "font-semibold" : ""}`}>{item.name}{showProject ? <span className="font-normal text-muted-foreground"> · {item.project}</span> : null}</span>
      </li>)}
    </ul>
  </section>;
}
