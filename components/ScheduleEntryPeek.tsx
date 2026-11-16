"use client";

import { useEffect, useRef, useState } from "react";
import { milestoneCategory, scheduleKind } from "@/lib/scheduleInsights";
import { scheduleTypeSchema, type ScheduleType } from "@/lib/schema";
import { useEscape } from "./CalendarParts";
import { CategoryPicker } from "./CategoryPicker";
import type { ScheduleSnapshotEntry } from "@/types/electron";
import { ScheduleKindMark } from "./ScheduleKindMark";

function whenLabel(entry: ScheduleSnapshotEntry): string {
  if (!entry.date) return "No date";
  const timed = entry.date.includes("T");
  const start = new Date(timed ? entry.date : `${entry.date}T12:00:00`);
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(start);
  if (!timed) return day;
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${clock.format(start)}${entry.date_end?.includes("T") ? ` – ${clock.format(new Date(entry.date_end))}` : ""}`;
}

export function entryKind(entry: Pick<ScheduleSnapshotEntry, "name" | "type">) {
  return scheduleKind({ name: entry.name, type: scheduleTypeSchema.safeParse(entry.type[0]).data });
}

/** What a calendar item opens: the facts first, leaving Mi only when someone asks to. */
export function ScheduleEntryPeek({ entry, sourceLabel, onOpenSource, onClose, onSaveCategory }: {
  entry: ScheduleSnapshotEntry;
  sourceLabel: string;
  onOpenSource: () => void;
  onClose: () => void;
  /** Absent for a read-only source such as Google. */
  onSaveCategory?: (type: ScheduleType) => Promise<void>;
}) {
  const current = milestoneCategory({ name: entry.name, type: scheduleTypeSchema.safeParse(entry.type[0]).data });
  const [category, setCategory] = useState<ScheduleType>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  useEscape(onClose);
  const people = entry.attendees.map((person) => person.name).filter(Boolean).join(", ");
  return <div className="fixed inset-0 z-[65] flex items-start justify-center bg-black/30 p-4 pt-[18vh]" onClick={onClose} role="presentation">
    <div role="dialog" aria-modal="true" aria-label={entry.name} onClick={(event) => event.stopPropagation()} className="w-full max-w-lg space-y-2 rounded-lg border border-border bg-card p-4 shadow-xl">
      <div className="flex items-start gap-2">
        <span className="mt-1.5"><ScheduleKindMark kind={entryKind(entry)} /></span>
        <h3 className="min-w-0 flex-1 break-words font-medium">{entry.name}</h3>
        <button ref={close} type="button" aria-label="Close" onClick={onClose} className="px-1 text-muted-foreground hover:text-foreground">×</button>
      </div>
      <p className="text-sm text-muted-foreground">{whenLabel(entry)}</p>
      {entry.status && <p className="text-sm text-muted-foreground">{entry.status}</p>}
      {people && <p className="text-sm text-muted-foreground">{people}</p>}
      {onSaveCategory && <CategoryPicker value={category} onChange={setCategory} disabled={saving} label={`Category for ${entry.name}`} />}
      {error && <p role="alert" className="text-sm text-status-danger-foreground">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        {onSaveCategory && category !== current && <button type="button" disabled={saving} onClick={() => {
          setSaving(true);
          setError("");
          onSaveCategory(category).catch((cause) => {
            setError(cause instanceof Error ? cause.message : "Notion could not be updated.");
            setSaving(false);
          });
        }} className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50">{saving ? "Saving…" : "Save to Notion"}</button>}
        <button type="button" onClick={onOpenSource} className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent">Open in {sourceLabel}</button>
      </div>
    </div>
  </div>;
}
