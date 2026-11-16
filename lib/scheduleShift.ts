const DAY_MS = 86_400_000;
const LEADING_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY_MS);
}

/** Moves a Notion date or timestamp by whole days, keeping its clock time and offset. */
export function shiftByDays(value: string, days: number): string {
  const match = LEADING_DATE.exec(value);
  if (!match) throw new Error("Use a date that starts with YYYY-MM-DD.");
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${shifted.toISOString().slice(0, 10)}${value.slice(10)}`;
}

/** The end that keeps an event's length when its start moves to a new moment. */
export function endAfterMove(start: string, end: string, newStart: string): string {
  const length = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(length) || length < 0) throw new Error("This event has an invalid time range.");
  return new Date(Date.parse(newStart) + length).toISOString();
}
