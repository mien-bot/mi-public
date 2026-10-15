import type { ScheduleSnapshot, ScheduleSnapshotEntry } from "@/types/electron";
import type { ScheduleCopilotProposal } from "@/lib/scheduleCopilot";
import {
  canonicalTimestampInTimezone,
  localDateTimeToCanonical,
  timeInTimezone,
} from "@/lib/content/timezone";

export type ScheduleCalendarView = "month" | "week" | "work-week" | "day";
export type ScheduleDragMode = "move" | "resize" | "duplicate";

function copyDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function buildDragDuplicateProposal(
  entry: ScheduleSnapshotEntry,
  newDate: string,
  requestId: string,
  options: { targetMinutes?: number | null; timezone?: string } = {},
): ScheduleCopilotProposal | null {
  const currentDate = entry.date?.slice(0, 10) ?? null;
  if (!currentDate) return null;
  dateFromScheduleKey(newDate);
  const { startTime, endTime } = changedTimestamp(
    entry,
    newDate,
    "duplicate",
    options.targetMinutes ?? null,
    options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  return {
    id: `calendar-copy-${requestId}`,
    title: `Duplicate ${entry.name}`,
    reason: "Ctrl-dragged to create a separate calendar event.",
    kind: "schedule-duplicate",
    data: {
      eventPageId: entry.notion_page_id,
      name: entry.name,
      currentDate,
      newDate,
      newStartTime: startTime,
      newEndTime: endTime,
    },
  };
}

export function scheduleDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateFromScheduleKey(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Use YYYY-MM-DD.");
  const result = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (scheduleDateKey(result) !== value) throw new Error("Use a real calendar date.");
  return result;
}

function weekStart(anchor: Date): Date {
  const start = copyDate(anchor);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

export function scheduleVisibleDays(anchor: Date, view: ScheduleCalendarView): Date[] {
  if (view === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = copyDate(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }
  if (view === "day") return [copyDate(anchor)];
  const start = weekStart(anchor);
  if (view === "work-week") start.setDate(start.getDate() + 1);
  const count = view === "work-week" ? 5 : 7;
  return Array.from({ length: count }, (_, index) => {
    const date = copyDate(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function moveScheduleAnchor(anchor: Date, view: ScheduleCalendarView, offset: -1 | 1): Date {
  const next = copyDate(anchor);
  if (view === "month") next.setMonth(next.getMonth() + offset, 1);
  else next.setDate(next.getDate() + offset * (view === "day" ? 1 : 7));
  return next;
}

export function scheduleViewHeading(anchor: Date, view: ScheduleCalendarView): string {
  if (view === "month") {
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(anchor);
  }
  if (view === "day") {
    return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(anchor);
  }
  const days = scheduleVisibleDays(anchor, view);
  const first = days[0];
  const last = days[days.length - 1];
  const firstLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(first);
  const lastLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(last);
  return `${firstLabel} – ${lastLabel}`;
}

export function canDragScheduleEntry(entry: ScheduleSnapshotEntry): boolean {
  return Boolean(entry.date);
}

function durationMs(entry: ScheduleSnapshotEntry): number | null {
  if (!entry.date?.includes("T") || !entry.date_end) return null;
  const duration = Date.parse(entry.date_end) - Date.parse(entry.date);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function minutesLabel(minutes: number): string {
  const clamped = Math.min(24 * 60 - 1, Math.max(0, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function changedTimestamp(
  entry: ScheduleSnapshotEntry,
  newDate: string,
  mode: ScheduleDragMode,
  targetMinutes: number | null,
  timezone: string,
): { startTime: string | null; endTime: string | null } {
  const currentStartTime = entry.date?.includes("T") ? entry.date : null;
  if (!currentStartTime) {
    if (mode === "resize") throw new Error("Only a timed Date range can be resized.");
    if (targetMinutes === null) return { startTime: null, endTime: null };
    const startTime = localDateTimeToCanonical(newDate, minutesLabel(targetMinutes), timezone);
    return {
      startTime,
      endTime: canonicalTimestampInTimezone(new Date(Date.parse(startTime) + 60 * 60_000), timezone),
    };
  }
  const oldStart = new Date(currentStartTime);
  if (Number.isNaN(oldStart.getTime())) throw new Error("This event has an invalid Date start and cannot be moved safely.");
  const startTime = mode === "resize"
    ? currentStartTime
    : localDateTimeToCanonical(
        newDate,
        targetMinutes === null ? timeInTimezone(oldStart, timezone) : minutesLabel(targetMinutes),
        timezone,
      );

  if (mode === "resize") {
    if (targetMinutes === null) throw new Error("Drop the resize handle on a time in the day grid.");
    const endTime = localDateTimeToCanonical(newDate, minutesLabel(targetMinutes), timezone);
    if (Date.parse(endTime) <= Date.parse(startTime)) {
      throw new Error("The resized end must be after the event start.");
    }
    return { startTime, endTime };
  }

  const duration = durationMs(entry);
  if (entry.date_end && duration === null) throw new Error("This event has an invalid Date end and cannot be moved safely.");
  return {
    startTime,
    endTime: duration === null
      ? null
      : canonicalTimestampInTimezone(new Date(Date.parse(startTime) + duration), timezone),
  };
}

export function buildDragRescheduleProposal(
  entry: ScheduleSnapshotEntry,
  newDate: string,
  requestId: string,
  options: {
    mode?: ScheduleDragMode;
    targetMinutes?: number | null;
    timezone?: string;
  } = {},
): ScheduleCopilotProposal | null {
  const currentDate = entry.date?.slice(0, 10) ?? null;
  if (!currentDate) return null;
  dateFromScheduleKey(newDate);
  const mode = options.mode ?? "move";
  const proposedDate = mode === "resize" ? currentDate : newDate;
  const { startTime, endTime } = changedTimestamp(
    entry,
    newDate,
    mode,
    options.targetMinutes ?? null,
    options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  if (
    currentDate === proposedDate
    && (entry.date?.includes("T") ? entry.date : null) === startTime
    && (entry.date_end ?? null) === endTime
  ) return null;
  return {
    id: `calendar-move-${requestId}`,
    title: `${mode === "resize" ? "Resize" : "Move"} ${entry.name}`,
    reason: `${mode === "resize" ? "Dragged to a new Date end" : "Dragged to a new calendar position"}.`,
    kind: "schedule-reschedule",
    data: {
      eventPageId: entry.notion_page_id,
      name: entry.name,
      currentDate,
      newDate: proposedDate,
      currentStartTime: entry.date?.includes("T") ? entry.date : null,
      currentEndTime: entry.date_end ?? null,
      newStartTime: startTime,
      newEndTime: endTime,
    },
  };
}

/** Updates only Notion's Date range while the authoritative snapshot refresh is in flight. */
export function applyOptimisticScheduleReschedule(
  snapshot: ScheduleSnapshot | null,
  proposal: Extract<ScheduleCopilotProposal, { kind: "schedule-reschedule" }>,
): ScheduleSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    entries: snapshot.entries.map((entry) => entry.notion_page_id === proposal.data.eventPageId
      ? {
          ...entry,
          date: proposal.data.newStartTime ?? proposal.data.newDate,
          date_end: proposal.data.newEndTime,
        }
      : entry),
  };
}
