import type { ScheduleKind } from "@/lib/scheduleInsights";

/** Shape and color both differ, so the kinds still read apart without color. */
export const SCHEDULE_KINDS: readonly ScheduleKind[] = ["milestone", "client", "meeting", "work"];

export const KIND_LABEL: Record<ScheduleKind, string> = {
  milestone: "Milestones",
  client: "Client meetings",
  meeting: "Meetings",
  work: "Work sessions",
};

export const KIND_MARK: Record<ScheduleKind, string> = {
  milestone: "h-2.5 w-2.5 rotate-45 bg-accent",
  client: "h-2.5 w-2.5 rounded-full border-[3px] border-status-success-foreground",
  meeting: "h-2.5 w-2.5 rounded-full bg-status-warning-foreground",
  work: "h-1.5 w-3 rounded-sm bg-muted-foreground",
};

export const KIND_CHIP: Record<ScheduleKind, string> = {
  milestone: "rounded border-l-4 border-accent bg-accent/25 font-medium",
  client: "rounded-full border-2 border-status-success-foreground/70 bg-status-success/50 font-medium",
  meeting: "rounded-full border border-status-warning-foreground/50 bg-status-warning/40",
  work: "rounded border border-dashed border-muted-foreground/50 text-muted-foreground",
};

export const KIND_DAY: Record<ScheduleKind, string> = {
  milestone: "bg-accent font-semibold text-accent-foreground",
  client: "bg-status-success font-medium text-status-success-foreground",
  meeting: "bg-status-warning font-medium text-status-warning-foreground",
  work: "bg-muted text-foreground",
};
