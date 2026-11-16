import type { Milestone } from "@/lib/schema";
import { categoryIsGuess, isScheduleEvent } from "@/lib/scheduleInsights";

export interface ProjectAsk {
  id: string;
  kind: "overdue" | "past-event" | "category";
  milestone: Milestone;
}

/**
 * Questions only a person can answer, worked out from the saved schedule. Nothing here is an
 * AI guess or a write: each answer goes through the same schedule route as the Plan page.
 */
export function projectAsks(milestones: Milestone[], today: string): ProjectAsk[] {
  const active = milestones
    .filter((item) => !item.archived_at)
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date) || a.id.localeCompare(b.id));
  const open = active.filter((item) => !item.actual_date);
  const past = open.filter((item) => item.planned_date.slice(0, 10) < today);
  return [
    ...past.filter((item) => !isScheduleEvent(item))
      .map((milestone) => ({ id: `overdue:${milestone.id}:${milestone.planned_date}`, kind: "overdue" as const, milestone })),
    ...past.filter(isScheduleEvent)
      .map((milestone) => ({ id: `past-event:${milestone.id}:${milestone.planned_date}`, kind: "past-event" as const, milestone })),
    ...open.filter(categoryIsGuess)
      .map((milestone) => ({ id: `category:${milestone.id}`, kind: "category" as const, milestone })),
  ];
}
