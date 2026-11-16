/** "Nov 20, 2026" for a saved YYYY-MM-DD. The year drops when it is the current one. */
export function formatDay(value: string, today: string): string {
  const key = value.slice(0, 10);
  const parsed = new Date(`${key}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(key.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
  }).format(parsed);
}
