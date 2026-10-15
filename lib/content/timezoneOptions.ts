const REQUIRED_TIMEZONE_IDS = [
  "America/Chicago",
  "America/New_York",
  "Asia/Taipei",
  "UTC",
] as const;

const FALLBACK_TIMEZONE_IDS = [
  "Africa/Abidjan",
  "Africa/Accra",
  "Africa/Addis_Ababa",
  "Africa/Cairo",
  "Africa/Casablanca",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Caracas",
  "America/Chicago",
  "America/Denver",
  "America/Detroit",
  "America/Halifax",
  "America/Indiana/Indianapolis",
  "America/Lima",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Montevideo",
  "America/New_York",
  "America/Phoenix",
  "America/Puerto_Rico",
  "America/Sao_Paulo",
  "America/St_Johns",
  "America/Toronto",
  "America/Vancouver",
  "America/Winnipeg",
  "Antarctica/McMurdo",
  "Asia/Baghdad",
  "Asia/Bangkok",
  "Asia/Beirut",
  "Asia/Colombo",
  "Asia/Dhaka",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Jerusalem",
  "Asia/Kabul",
  "Asia/Karachi",
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Riyadh",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Taipei",
  "Asia/Tehran",
  "Asia/Tokyo",
  "Asia/Ulaanbaatar",
  "Asia/Yangon",
  "Atlantic/Azores",
  "Atlantic/Bermuda",
  "Atlantic/Cape_Verde",
  "Atlantic/Reykjavik",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Darwin",
  "Australia/Hobart",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Brussels",
  "Europe/Bucharest",
  "Europe/Budapest",
  "Europe/Copenhagen",
  "Europe/Dublin",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Kyiv",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Europe/Prague",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Vienna",
  "Europe/Warsaw",
  "Europe/Zurich",
  "Indian/Maldives",
  "Indian/Mauritius",
  "Pacific/Auckland",
  "Pacific/Chatham",
  "Pacific/Fiji",
  "Pacific/Guam",
  "Pacific/Honolulu",
  "Pacific/Noumea",
  "Pacific/Pago_Pago",
  "Pacific/Port_Moresby",
  "Pacific/Tahiti",
  "Pacific/Tongatapu",
  "UTC",
] as const;

const OFFSET_REFERENCE_INSTANTS = [
  new Date("2026-01-15T12:00:00.000Z"),
  new Date("2026-07-15T12:00:00.000Z"),
] as const;

export type TimezoneSupportedValuesOf = (key: "timeZone") => string[];

export interface TimezoneOption {
  id: string;
  label: string;
}

export function canonicalizeIanaTimezone(value: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function offsetMinutesAt(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  const representedAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return Math.round((representedAsUtc - instant.getTime()) / 60_000);
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const remainder = String(absolute % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${remainder}`;
}

export function timezoneOffsetLabel(timeZone: string): string {
  const offsets = OFFSET_REFERENCE_INSTANTS
    .map((instant) => offsetMinutesAt(timeZone, instant))
    .filter((offset, index, values) => values.indexOf(offset) === index)
    .map(formatOffset);
  return offsets.join(" / ");
}

function sourceTimezoneIds(supportedValuesOf?: TimezoneSupportedValuesOf): readonly string[] {
  if (!supportedValuesOf) return FALLBACK_TIMEZONE_IDS;
  try {
    const values = supportedValuesOf("timeZone");
    return values.length > 0 ? values : FALLBACK_TIMEZONE_IDS;
  } catch {
    return FALLBACK_TIMEZONE_IDS;
  }
}

export function getTimezoneOptions(
  supportedValuesOf?: TimezoneSupportedValuesOf,
): TimezoneOption[] {
  const ids = new Set<string>();
  for (const value of [...sourceTimezoneIds(supportedValuesOf), ...REQUIRED_TIMEZONE_IDS]) {
    const canonical = canonicalizeIanaTimezone(value);
    if (canonical) ids.add(canonical);
  }
  return [...ids]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((id) => ({ id, label: `${id} (${timezoneOffsetLabel(id)})` }));
}

export const DETERMINISTIC_TIMEZONE_OPTIONS = getTimezoneOptions();

export function getRuntimeTimezoneOptions(): TimezoneOption[] {
  const runtimeIntl = Intl as typeof Intl & {
    supportedValuesOf?: TimezoneSupportedValuesOf;
  };
  const supportedValuesOf = runtimeIntl.supportedValuesOf?.bind(runtimeIntl);
  return getTimezoneOptions(supportedValuesOf);
}

export function includeTimezoneOption(
  options: readonly TimezoneOption[],
  value: string | null | undefined,
): TimezoneOption[] {
  if (!value) return [...options];
  const canonical = canonicalizeIanaTimezone(value);
  if (!canonical || options.some((option) => option.id === canonical)) return [...options];
  return [...options, { id: canonical, label: `${canonical} (${timezoneOffsetLabel(canonical)})` }]
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
}
