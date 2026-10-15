import {
  scheduleCopilotProposalSchema,
  type ScheduleCopilotProposal,
} from "@/lib/scheduleCopilot";
import { localDateTimeToCanonical } from "@/lib/content/timezone";
import type { ScheduleType } from "@/lib/schema";

const NOTION_PAGE_ID = /^[a-f0-9-]{32,36}$/i;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ScheduleProjectOption {
  notionPageId: string;
  name: string;
}

export interface ScheduleAttendeeOption {
  id: string;
  name: string;
  /** Only shown to tell apart two accounts whose display names read the same. */
  email?: string;
}

export interface ScheduleCreateFormInput {
  name: string;
  date: string;
  type: ScheduleType;
  startTime: string;
  endTime: string;
  project: ScheduleProjectOption | null;
  attendees?: ScheduleAttendeeOption[];
  timezone?: string;
}

/** Keep only exact, already-confirmed Notion links from the shared project picker response. */
export function scheduleProjectOptions(value: unknown): ScheduleProjectOption[] {
  if (!value || typeof value !== "object") return [];
  const projects = (value as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) return [];

  return projects.flatMap((project) => {
    if (!project || typeof project !== "object") return [];
    const { notionPageId, name } = project as { notionPageId?: unknown; name?: unknown };
    if (typeof notionPageId !== "string" || !NOTION_PAGE_ID.test(notionPageId)) return [];
    if (typeof name !== "string" || !name.trim()) return [];
    return [{ notionPageId, name: name.trim() }];
  });
}

/** Convert an HTML date/time pair into the exact local instant Notion expects. */
export function localDateTimeWithOffset(date: string, time: string): string | null {
  const dateMatch = DATE_ONLY.exec(date);
  const timeMatch = TIME_ONLY.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    local.getFullYear() !== year
    || local.getMonth() !== month - 1
    || local.getDate() !== day
    || local.getHours() !== hour
    || local.getMinutes() !== minute
  ) return null;

  const offset = -local.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const offsetMinutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return `${date}T${time}:00${sign}${offsetHours}:${offsetMinutes}`;
}

export function buildCalendarScheduleProposal(input: ScheduleCreateFormInput): ScheduleCopilotProposal {
  if (input.endTime && !input.startTime) {
    throw new Error("Choose a start time before choosing an end time.");
  }
  const startTime = input.startTime
    ? input.timezone
      ? localDateTimeToCanonical(input.date, input.startTime, input.timezone)
      : localDateTimeWithOffset(input.date, input.startTime)
    : null;
  const endTime = input.endTime
    ? input.timezone
      ? localDateTimeToCanonical(input.date, input.endTime, input.timezone)
      : localDateTimeWithOffset(input.date, input.endTime)
    : null;
  if (input.startTime && !startTime) throw new Error("Choose a valid start date and time.");
  if (input.endTime && !endTime) throw new Error("Choose a valid end date and time.");

  const parsed = scheduleCopilotProposalSchema.safeParse({
    id: `calendar-event-${crypto.randomUUID()}`,
    title: input.name.trim(),
    reason: "Entered directly in the STUDIO calendar.",
    kind: "schedule-create",
    data: {
      name: input.name.trim(),
      date: input.date,
      type: input.type,
      startTime,
      endTime,
      projectPageId: input.project?.notionPageId ?? null,
      projectName: input.project?.name ?? null,
      attendeeIds: (input.attendees ?? []).map((attendee) => attendee.id),
    },
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Review the event details.");
  }
  return parsed.data;
}
