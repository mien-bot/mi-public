"use client";

import { useMemo } from "react";
import { computeJournalStreaks, streakMilestone } from "@/lib/personal/streaks";
import type { PersonalRecord } from "@/lib/personal/schema";

export function PersonalJournalSummary({ records, timezone }: { records: PersonalRecord[]; timezone: string }) {
  const streaks = useMemo(() => computeJournalStreaks(records, timezone), [records, timezone]);
  const milestone = streakMilestone(streaks.currentStreak);
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">Journal</p>
        <h2 className="mt-1 font-display text-xl font-light">Your writing rhythm</h2>
        <p className="mt-1 text-xs text-muted-foreground">Private reflections and streaks live here, separate from tasks and calendar items.</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-background p-4 text-center">
          <p className="text-3xl font-light">{streaks.currentStreak}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">Current streak · {streaks.loggedToday ? "written today" : "write today to continue"}</p>
        </div>
        <div className="rounded-lg border border-border bg-background p-4 text-center">
          <p className="text-3xl font-light">{streaks.longestStreak}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">Longest streak</p>
        </div>
        <div className="rounded-lg border border-border bg-background p-4 text-center">
          <p className="text-3xl font-light">{streaks.totalEntries}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">Journal entries · {streaks.totalDaysJournaled} days</p>
        </div>
      </div>
      {milestone && <p role="status" className="mt-4 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-center text-sm font-medium text-accent">{milestone} day streak — keep it going.</p>}
    </section>
  );
}
