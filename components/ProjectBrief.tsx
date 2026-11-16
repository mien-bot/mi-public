import Link from "next/link";
import type { ReactNode } from "react";
import { formatDay } from "@/lib/displayDate";
import type { Milestone } from "@/lib/schema";
import { projectFocus, scopeExcerpt, upcomingAgenda } from "@/lib/projectSnapshot";
import { scheduleKind } from "@/lib/scheduleInsights";
import { ScheduleKindMark } from "./ScheduleKindMark";

const relativeDay = (days: number) => days === 0 ? "Today" : days === 1 ? "Tomorrow" : days > 0 ? `In ${days} days` : `${-days} day${days === -1 ? "" : "s"} overdue`;

/** The first thing on the page: one next step, what needs you, and the days ahead. */
export function ProjectBrief({ slug, scope, attention, milestones, today, reviewCount, children }: {
  slug: string;
  scope: string;
  attention: Array<{ code: string; label: string; href?: string }>;
  milestones: Milestone[];
  today: string;
  reviewCount: number;
  children?: ReactNode;
}) {
  const excerpt = scopeExcerpt(scope);
  const base = `/projects/${slug}`;
  const focus = projectFocus(milestones, today);
  // The focus card already answers these two, and it knows a past meeting is not overdue.
  const reasons = attention.filter((reason) => reason.code !== "overdue-milestones" && reason.code !== "no-upcoming-milestone");
  const agenda = upcomingAgenda(milestones, today).filter((item) => item.id !== focus.item?.id).slice(0, 4);
  return <section className="space-y-4" aria-label="Project in a minute">
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <div className={`rounded-xl border-l-4 border border-border bg-card p-5 ${focus.overdue ? "border-l-status-danger-foreground" : "border-l-accent"}`}>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{focus.overdue ? "Overdue" : "Next up"}</p>
        {focus.item ? <>
          <Link href={`${base}/schedule`} className="mt-2 block font-display text-2xl font-light leading-snug hover:underline">{focus.item.name}</Link>
          <p className={`mt-1 text-sm ${focus.overdue ? "font-medium text-status-danger-foreground" : "text-muted-foreground"}`}>{relativeDay(focus.days)} · {formatDay(focus.item.planned_date, today)}</p>
        </> : <>
          <p className="mt-2 font-display text-2xl font-light">What&apos;s due next?</p>
          <Link href={`${base}/schedule`} className="mt-1 inline-block text-sm text-link underline">Add a date in Plan</Link>
        </>}
        {focus.overdueCount > 1 && <p className="mt-2 text-xs text-muted-foreground">{focus.overdueCount - 1} more overdue in Plan</p>}
      </div>
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-medium">Needs you</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {reviewCount > 0 && <li><Link className="text-link underline" href={`/review?workspace=${encodeURIComponent(`project/${slug}`)}`}>{reviewCount} waiting in the inbox</Link></li>}
          {reasons.slice(0, 3).map((reason) => <li key={reason.code}><Link className="text-link underline" href={reason.href || `${base}/schedule`}>{reason.label}</Link></li>)}
        </ul>
        {reviewCount === 0 && reasons.length === 0 && <p className="mt-2 text-sm text-muted-foreground">You&apos;re all caught up.</p>}
        {reasons.length > 3 && <p className="mt-2 text-xs text-muted-foreground">+{reasons.length - 3} more below</p>}
      </div>
    </div>

    {children}

    {agenda.length > 0 && <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Coming up</h2>
        <Link href={`${base}/schedule`} className="text-sm text-link underline">Open Plan</Link>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {agenda.map((item) => <li key={item.id} className="flex items-center gap-3 py-2 text-sm">
          <ScheduleKindMark kind={scheduleKind(item)} />
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={item.planned_date}>{formatDay(item.planned_date, today)}</time>
        </li>)}
      </ul>
    </div>}

    {excerpt.text
      ? <p className="max-w-3xl text-sm text-muted-foreground">{excerpt.text}</p>
      : <Link href={`${base}/details`} className="text-sm text-link underline">Record what this project will do</Link>}
    {excerpt.shortened && <details className="text-sm"><summary className="cursor-pointer text-link">Read full scope</summary><p className="mt-2 whitespace-pre-wrap">{scope}</p></details>}
  </section>;
}
