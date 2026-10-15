import { getReviews } from "./projects";
import type { Discipline } from "@/lib/schema";

const STALE_AFTER_DAYS = 30;

export interface ReviewAgingEntry {
  slug: string;
  discipline: Discipline;
  date: string;
  daysOpen: number;
  stale: boolean;
}

function daysBetween(from: string, to: Date): number {
  const fromDate = new Date(from);
  return Math.floor((to.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
}

/** Aging for reviews still open (or in-progress) — mirrors permitAging.ts's pattern, over reviewFrontmatterSchema's existing status/date fields. */
export function getReviewAging(projectSlug: string, today: Date = new Date()): ReviewAgingEntry[] {
  return getReviews(projectSlug)
    .filter((review) => review.frontmatter.status === "open" || review.frontmatter.status === "in-progress")
    .map((review) => {
      const daysOpen = daysBetween(review.frontmatter.date, today);
      return {
        slug: review.slug,
        discipline: review.frontmatter.discipline,
        date: review.frontmatter.date,
        daysOpen,
        stale: daysOpen > STALE_AFTER_DAYS,
      };
    });
}
