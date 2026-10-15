import type { MeetingAgendaItem } from "@/lib/schema";

export function meetingAgendaMinutes(items: MeetingAgendaItem[]): number {
  return items.reduce((total, item) => total + item.duration_minutes, 0);
}
