export const DEFAULT_TIMEZONE = "America/Chicago";

interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInTimezone(date: Date, timeZone: string): DateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

export function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

function offsetMinutesAt(date: Date, timeZone: string): number {
  const parts = partsInTimezone(date, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((representedAsUtc - date.getTime()) / 60_000);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Returns a stable YYYY-MM-DD value for an instant in the selected IANA zone. */
export function dateInTimezone(
  date: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!isValidIanaTimezone(timeZone)) timeZone = DEFAULT_TIMEZONE;
  const parts = partsInTimezone(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Returns a stable 24-hour HH:MM wall-clock value for an instant in the selected zone. */
export function timeInTimezone(
  date: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!isValidIanaTimezone(timeZone)) timeZone = DEFAULT_TIMEZONE;
  const parts = partsInTimezone(date, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Serializes an existing instant with the offset that applies in the selected IANA zone. */
export function canonicalTimestampInTimezone(
  date: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!isValidIanaTimezone(timeZone)) throw new Error("Select a valid IANA timezone.");
  const parts = partsInTimezone(date, timeZone);
  const offset = offsetMinutesAt(date, timeZone);
  const sign = offset >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offset);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.000${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

/**
 * Converts a wall-clock value in an IANA zone into an offset-bearing timestamp.
 * Nonexistent spring-forward times are rejected. During the repeated fall-back
 * hour, the earlier occurrence is selected deterministically.
 */
export function localDateTimeToCanonical(
  date: string,
  time: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!isValidIanaTimezone(timeZone)) throw new Error("Select a valid IANA timezone.");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) throw new Error("Use a valid local date and time.");
  const desired: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: 0,
  };
  if (desired.hour > 23 || desired.minute > 59) throw new Error("Use a valid local date and time.");

  const wallUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    0,
  );
  let offset = offsetMinutesAt(new Date(wallUtc), timeZone);
  let instant = new Date(wallUtc - offset * 60_000);
  const correctedOffset = offsetMinutesAt(instant, timeZone);
  if (correctedOffset !== offset) {
    offset = correctedOffset;
    instant = new Date(wallUtc - offset * 60_000);
  }

  const roundTrip = partsInTimezone(instant, timeZone);
  if (Object.keys(desired).some((key) => desired[key as keyof DateTimeParts] !== roundTrip[key as keyof DateTimeParts])) {
    throw new Error(`That local time does not exist in ${timeZone} because of daylight saving time.`);
  }

  const sign = offset >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offset);
  return `${date}T${time}:00.000${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

/** Date-only Notion values stay date-only; timestamps are rendered in the preference zone. */
export function formatNotionTimestamp(
  value: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!isValidIanaTimezone(timeZone)) timeZone = DEFAULT_TIMEZONE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
