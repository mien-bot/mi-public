import type { Milestone } from "@/lib/schema";
import { isScheduleEvent } from "@/lib/scheduleInsights";

/** An excerpt, never an invented or rewritten project fact. */
export function scopeExcerpt(scope: string, limit = 220) {
  const text = scope.replace(/\s+/g, " ").trim();
  const characters = Array.from(text);
  if (characters.length <= limit) return { text, shortened: false };
  const prefix = characters.slice(0, limit).join("");
  const boundary = prefix.lastIndexOf(" ");
  return { text: `${boundary > limit / 2 ? prefix.slice(0, boundary) : prefix}…`, shortened: true };
}

export function milestoneTrail(milestones: Milestone[]) {
  const active = milestones.filter(item => !item.archived_at);
  const remaining = active.filter(item => !item.actual_date)
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date) || a.id.localeCompare(b.id));
  return { total: active.length, completed: active.length - remaining.length,
    remaining: remaining.length, next: remaining.slice(0, 4) };
}

const open = (milestones: Milestone[]) => milestones
  .filter((item) => !item.archived_at && !item.actual_date)
  .sort((a, b) => a.planned_date.localeCompare(b.planned_date) || a.id.localeCompare(b.id));

const dayNumber = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86_400_000;

/** A missed meeting or work session is history, so only a milestone can be overdue here. */
export function projectFocus(milestones: Milestone[], today: string) {
  const remaining = open(milestones);
  const overdue = remaining.filter((item) => item.planned_date.slice(0, 10) < today && !isScheduleEvent(item));
  const item = overdue[0] ?? remaining.find((entry) => entry.planned_date.slice(0, 10) >= today) ?? null;
  return {
    item,
    overdue: overdue.length > 0,
    overdueCount: overdue.length,
    days: item ? dayNumber(item.planned_date) - dayNumber(today) : 0,
  };
}

export function upcomingAgenda(milestones: Milestone[], today: string) {
  return open(milestones).filter((item) => item.planned_date.slice(0, 10) >= today);
}
