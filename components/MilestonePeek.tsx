"use client";

import { useEffect, useRef, useState } from "react";
import { computeMilestoneStatus } from "@/lib/content/status";
import { milestoneCategory, scheduleKind } from "@/lib/scheduleInsights";
import type { Milestone, ScheduleType } from "@/lib/schema";
import { useEscape } from "./CalendarParts";
import { CategoryPicker } from "./CategoryPicker";
import { DeleteRecordButton } from "./DeleteRecordButton";
import { ScheduleKindMark } from "./ScheduleKindMark";
import { StatusBadge } from "./StatusBadge";

/** The small card a calendar item opens: the common actions without leaving the calendar. */
export function MilestonePeek({ milestone, disabled, onClose, onToggleComplete, onCategory, onReschedule, onDelete, onOpenTimeline, onSendToNotion, onAllowRetry }: {
  milestone: Milestone;
  disabled: boolean;
  onClose: () => void;
  onToggleComplete: () => void;
  onCategory: (type: ScheduleType) => void;
  onReschedule: (date: string, time: string | null) => void;
  onDelete?: () => Promise<void>;
  onOpenTimeline: () => void;
  onSendToNotion?: () => void;
  onAllowRetry?: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, []);
  useEscape(onClose);
  const [day, setDay] = useState(milestone.planned_date.slice(0, 10));
  const [time, setTime] = useState(milestone.start_time ?? "");
  const changed = Boolean(day) && (day !== milestone.planned_date.slice(0, 10) || time !== (milestone.start_time ?? ""));
  return <div className="fixed inset-0 z-[65] flex items-start justify-center bg-black/30 p-4 pt-[18vh]" onClick={onClose} role="presentation">
    <div
      role="dialog"
      aria-modal="true"
      aria-label={milestone.name}
      onClick={(event) => event.stopPropagation()}
      className="w-full max-w-lg space-y-3 rounded-lg border border-border bg-card p-4 shadow-xl"
    >
      <div className="flex items-start gap-2">
        <span className="mt-1.5"><ScheduleKindMark kind={scheduleKind(milestone)} /></span>
        <h3 className="min-w-0 flex-1 break-words font-medium">{milestone.name}</h3>
        <button ref={closeButton} type="button" aria-label="Close" onClick={onClose} className="px-1 text-muted-foreground hover:text-foreground">×</button>
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (changed) onReschedule(day, time || null); }}>
        <input type="date" required value={day} onChange={(event) => setDay(event.target.value)} aria-label="Date" className="rounded-md border border-border bg-background px-2 py-1 text-sm" />
        <input type="time" value={time} onChange={(event) => setTime(event.target.value)} aria-label="Time, optional" className="rounded-md border border-border bg-background px-2 py-1 text-sm" />
        {changed
          ? <button type="submit" disabled={disabled} className="rounded-md border border-border px-3 py-1 text-sm hover:border-accent">Save</button>
          : <StatusBadge status={computeMilestoneStatus(milestone)} />}
      </form>
      <CategoryPicker value={milestoneCategory(milestone)} onChange={onCategory} disabled={disabled} label={`Category for ${milestone.name}`} />
      {onAllowRetry && <div className="rounded-md border border-border p-2 text-sm">
        <p className="text-muted-foreground">A send may have reached Notion. Look for this item in STUDIO Schedule. If it isn&apos;t there, allow another send.</p>
        <button type="button" disabled={disabled} onClick={onAllowRetry} className="mt-2 rounded-md border border-border px-3 py-1 text-sm hover:border-accent">It didn&apos;t arrive</button>
      </div>}
      <div className="flex flex-wrap justify-end gap-2">
        {onDelete && <span className="mr-auto"><DeleteRecordButton disabled={disabled} prompt="Delete this item?" recoverableNote="" onDelete={onDelete} /></span>}
        {onSendToNotion && <button type="button" disabled={disabled} onClick={onSendToNotion} className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent">Send to Notion</button>}
        <button type="button" onClick={onOpenTimeline} className="rounded-md border border-border px-3 py-1.5 text-sm">Edit details</button>
        <button type="button" disabled={disabled} onClick={onToggleComplete} className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-40">{milestone.actual_date ? "Reopen" : "Mark complete"}</button>
      </div>
    </div>
  </div>;
}
