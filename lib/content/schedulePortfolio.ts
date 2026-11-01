import { timelineRow, type TimelineRow } from "@/lib/scheduleInsights";
import { getAllProjects, getSchedule, getScheduleWithHash, getProjectSlugs, writeProjectSchedule } from "./index";
import { getProjectDetails } from "./projectWorkspace";

/** Every project with something dated in the year. One unreadable project must not hide the rest. */
export function buildPortfolioTimeline(year: number): { rows: TimelineRow[]; unavailable: string[] } {
  const rows: TimelineRow[] = [];
  const unavailable: string[] = [];
  const prefix = String(year);
  for (const project of getAllProjects()) {
    try {
      const row = timelineRow(
        { slug: project.slug, name: project.meta.name },
        getSchedule(project.slug).milestones,
        getProjectDetails(project.slug),
      );
      const inYear = row.markers.some((marker) => marker.date.startsWith(prefix))
        || row.phases.some((phase) => phase.start.slice(0, 4) <= prefix && prefix <= phase.end.slice(0, 4));
      if (inYear) rows.push(row);
    } catch {
      unavailable.push(project.meta.name);
    }
  }
  return { rows: rows.sort((a, b) => a.name.localeCompare(b.name)), unavailable };
}

/**
 * Keeps a project's own schedule in step after a Studio calendar move writes to Notion, so the
 * project page and the Studio calendar never disagree until the next pull. Returns the slug
 * updated, or null when no project tracks that event.
 */
export function applyNotionMoveToProject(eventPageId: string, newDate: string): string | null {
  for (const slug of getProjectSlugs()) {
    const { hash } = getScheduleWithHash(slug);
    const full = getSchedule(slug, { includeArchived: true });
    const index = full.milestones.findIndex((item) => item.notion_event_id === eventPageId);
    if (index < 0) continue;
    if (full.milestones[index].planned_date.slice(0, 10) === newDate) return slug;
    full.milestones[index] = { ...full.milestones[index], planned_date: newDate };
    writeProjectSchedule(slug, full.milestones, { expectedHash: hash });
    return slug;
  }
  return null;
}
