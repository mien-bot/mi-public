"use client";

import { formatNotionTimestamp } from "@/lib/content/timezone";
import { usePersonalTimezone } from "./usePersonalTimezone";

export function NotionDateTime({ value }: { value: string }) {
  const { timezone } = usePersonalTimezone();
  return <time dateTime={value}>{formatNotionTimestamp(value, timezone)}</time>;
}
