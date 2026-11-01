import type { Milestone } from "@/lib/schema";

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
