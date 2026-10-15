export function formatMeetingTimeRange(startTime: string, endTime: string): string {
  if (startTime && endTime) return `${startTime}–${endTime}`;
  if (startTime) return `Starts ${startTime}; end unconfirmed`;
  if (endTime) return `Start unconfirmed; ends ${endTime}`;
  return "Time unconfirmed";
}
