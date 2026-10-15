import { getPermits } from "./projects";
import type { PermitEntry } from "@/lib/schema";

const STALE_AFTER_DAYS = 30;

export interface PermitAgingEntry {
  permit: PermitEntry;
  daysSinceSubmitted: number;
  stale: boolean;
}

function daysBetween(from: string, to: Date): number {
  const fromDate = new Date(from);
  return Math.floor((to.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
}

/** Aging for permits that are out for review — submitted but not yet approved/rejected. Pure function of existing permitEntrySchema fields, no new schema needed. */
export function getPermitAging(slug: string, today: Date = new Date()): PermitAgingEntry[] {
  return getPermits(slug)
    .filter((p) => (p.status === "submitted" || p.status === "under-review") && p.submitted_date)
    .map((permit) => {
      const daysSinceSubmitted = daysBetween(permit.submitted_date as string, today);
      return { permit, daysSinceSubmitted, stale: daysSinceSubmitted > STALE_AFTER_DAYS };
    });
}
