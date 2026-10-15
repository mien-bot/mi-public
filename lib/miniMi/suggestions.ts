import type { Milestone } from "@/lib/schema";
export interface CompanionSuggestion { id: string; title: string; detail: string; href: string }
export function milestoneSuggestions(slug: string, milestones: Milestone[], today: string): CompanionSuggestion[] {
  const end = new Date(`${today}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 7);
  const lastDay = end.toISOString().slice(0,10);
  return milestones.filter(m => !m.actual_date && /^\d{4}-\d{2}-\d{2}$/.test(m.planned_date) && m.planned_date >= today && m.planned_date <= lastDay)
    .sort((a,b) => a.planned_date.localeCompare(b.planned_date)).slice(0,2).map(m => ({
      id: `milestone:${slug}:${m.id}:${m.planned_date}`, title: m.name,
      detail: `Saved milestone · ${m.planned_date}. Due within the next seven days.`, href: `/projects/${slug}/schedule`,
    }));
}
