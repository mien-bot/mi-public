import {
  getDrawingIndex,
  getMarkupIndex,
  getPermits,
  getProgressLog,
  getReviews,
  getSchedule,
} from "./projects";
import { getLeadsForProject } from "./leads";

export type TimelineEntryType =
  | "progress-log"
  | "review"
  | "markup"
  | "permit"
  | "milestone"
  | "drawing"
  | "lead-conversion";

export interface TimelineEntry {
  date: string;
  type: TimelineEntryType;
  title: string;
  detail?: string;
  status?: string;
  href?: string;
}

/**
 * A "what happened" view of a project, composed entirely from existing
 * readers — no new schema. Sorted ascending by date. Upcoming (no
 * actual_date) milestones are deliberately excluded: this is history, not a
 * forecast.
 */
export function getProjectTimeline(slug: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const entry of getProgressLog(slug)) {
    entries.push({
      date: entry.frontmatter.date,
      type: "progress-log",
      title: `Progress log — ${entry.frontmatter.author}`,
      href: `/projects/${slug}`,
    });
  }

  for (const review of getReviews(slug)) {
    entries.push({
      date: review.frontmatter.date,
      type: "review",
      title: `${review.frontmatter.discipline} review`,
      status: review.frontmatter.status,
      href: `/projects/${slug}`,
    });
  }

  for (const markup of getMarkupIndex(slug)) {
    entries.push({
      date: markup.date,
      type: "markup",
      title: `${markup.sheet} rev.${markup.revision} markup`,
      detail: markup.discipline,
      status: markup.status,
      href: `/projects/${slug}/markups`,
    });
  }

  for (const permit of getPermits(slug)) {
    if (permit.submitted_date) {
      entries.push({
        date: permit.submitted_date,
        type: "permit",
        title: `${permit.permit_type} submitted`,
        href: `/projects/${slug}`,
      });
    }
    if (permit.approved_date) {
      entries.push({
        date: permit.approved_date,
        type: "permit",
        title: `${permit.permit_type} ${permit.status}`,
        status: permit.status,
        href: `/projects/${slug}`,
      });
    }
  }

  for (const milestone of getSchedule(slug).milestones) {
    if (milestone.actual_date) {
      entries.push({
        date: milestone.actual_date,
        type: "milestone",
        title: milestone.name,
        href: `/projects/${slug}/schedule`,
      });
    }
  }

  for (const drawing of getDrawingIndex(slug)) {
    entries.push({
      date: drawing.date,
      type: "drawing",
      title: `${drawing.sheet} rev.${drawing.revision} — ${drawing.phase.toUpperCase()}`,
      status: drawing.status,
      href: `/projects/${slug}/drawings`,
    });
  }

  for (const { slug: leadSlug, lead } of getLeadsForProject(slug)) {
    if (lead.converted_date) {
      entries.push({
        date: lead.converted_date,
        type: "lead-conversion",
        title: `Converted from lead "${lead.name}"`,
        detail: lead.source,
        href: `/leads/${leadSlug}`,
      });
    }
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date));
}
