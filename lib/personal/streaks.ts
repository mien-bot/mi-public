import type { PersonalRecord } from "./schema";

export interface JournalStreaks {
  currentStreak: number;
  longestStreak: number;
  totalDaysJournaled: number;
  totalEntries: number;
  /** YYYY-MM-DD calendar days (in the given timezone) with at least one journal entry. */
  journaledDays: Set<string>;
  /** True once today already has an entry. */
  loggedToday: boolean;
}

/** Formats an ISO timestamp as a YYYY-MM-DD calendar day in the given IANA timezone -- a
 * journal entry written at 11pm and one at 1am the same "day" for the user must land on the
 * same streak day, not split across UTC midnight. */
export function dayKey(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(key: string, delta: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + delta);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Mirrors Day One's Streaks: a run of consecutive calendar days with at least one journal
 * entry. The current streak isn't broken just because today hasn't been written yet -- it
 * counts through yesterday until the day is over, matching Day One's own behavior.
 */
export function computeJournalStreaks(
  records: PersonalRecord[],
  timezone: string,
  now: Date = new Date(),
): JournalStreaks {
  const journalEntries = records.filter((record) => record.kind === "journal");
  const journaledDays = new Set(journalEntries.map((record) => dayKey(record.createdAt, timezone)));
  const sortedDays = [...journaledDays].sort();

  let longestStreak = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sortedDays) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = day;
  }

  const today = dayKey(now.toISOString(), timezone);
  const loggedToday = journaledDays.has(today);
  let currentStreak = 0;
  let cursor = loggedToday ? today : addDays(today, -1);
  while (journaledDays.has(cursor)) {
    currentStreak += 1;
    cursor = addDays(cursor, -1);
  }

  return {
    currentStreak,
    longestStreak,
    totalDaysJournaled: journaledDays.size,
    totalEntries: journalEntries.length,
    journaledDays,
    loggedToday,
  };
}

/** Round-number milestones worth a small celebration, mirroring Day One's streak badges. */
export const STREAK_MILESTONES = [7, 14, 30, 50, 100, 200, 365, 500, 1000];

export function streakMilestone(currentStreak: number): number | null {
  return STREAK_MILESTONES.includes(currentStreak) ? currentStreak : null;
}
