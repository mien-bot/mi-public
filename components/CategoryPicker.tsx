"use client";

import { kindOfCategory, type ScheduleKind } from "@/lib/scheduleInsights";
import type { ScheduleType } from "@/lib/schema";
import { ScheduleKindMark } from "./ScheduleKindMark";
import { SCHEDULE_KINDS } from "./scheduleKindStyle";

const KIND_CHOICE: Record<ScheduleKind, { label: string; type: ScheduleType }> = {
  milestone: { label: "Milestone", type: "Deadline" },
  client: { label: "Client meeting", type: "Client Meeting" },
  meeting: { label: "Meeting", type: "Meeting" },
  work: { label: "Work session", type: "Work Session" },
};

/** The finer choices inside a kind, shown only once that kind is picked. */
const DETAIL: Partial<Record<ScheduleKind, [string, ScheduleType][]>> = {
  milestone: [["Deadline", "Deadline"], ["Midterm", "Midterm Deadline"], ["Kick-off", "Kick-off"]],
  meeting: [["General", "Meeting"], ["Internal", "Internal Meeting"]],
};

/** One tap to change an item's type. Kinds read the same here as on the calendar. */
export function CategoryPicker({ value, onChange, disabled = false, label = "Category" }: {
  value: ScheduleType;
  onChange: (type: ScheduleType) => void;
  disabled?: boolean;
  label?: string;
}) {
  const kind = kindOfCategory(value);
  const detail = DETAIL[kind];
  return <div className="space-y-1.5">
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {SCHEDULE_KINDS.map((option) => <button
        key={option}
        type="button"
        disabled={disabled}
        aria-pressed={kind === option}
        onClick={() => { if (kind !== option) onChange(KIND_CHOICE[option].type); }}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${kind === option ? "border-accent bg-accent/10 font-medium" : "border-border text-muted-foreground hover:border-accent hover:text-foreground"}`}
      >
        <ScheduleKindMark kind={option} />{KIND_CHOICE[option].label}
      </button>)}
    </div>
    {detail && <div role="group" aria-label={`${KIND_CHOICE[kind].label} type`} className="flex flex-wrap gap-1 pl-1">
      {detail.map(([text, type]) => <button
        key={type}
        type="button"
        disabled={disabled}
        aria-pressed={value === type}
        onClick={() => { if (value !== type) onChange(type); }}
        className={`rounded px-2 py-0.5 text-[11px] disabled:opacity-50 ${value === type ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
      >{text}</button>)}
    </div>}
  </div>;
}
