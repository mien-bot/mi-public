import type {
  PersonalRecord,
  PersonalRecordKind,
  PersonalRecordStatus,
} from "@/lib/personal/schema";

export type PersonalKindFilter = PersonalRecordKind | "all";
export type PersonalStatusFilter = PersonalRecordStatus | "all";
export type PersonalTimingFilter = "all" | "scheduled" | "upcoming" | "past" | "unscheduled";
export type PersonalRecordSort = "updated" | "created" | "scheduled" | "title";

export interface PersonalRecordListOptions {
  query?: string;
  kind?: PersonalKindFilter;
  status?: PersonalStatusFilter;
  timing?: PersonalTimingFilter;
  sort?: PersonalRecordSort;
  today?: string;
}

export interface PersonalRecordSummary {
  total: number;
  active: number;
  scheduled: number;
  shared: number;
}

function scheduleDate(record: PersonalRecord): string {
  return record.schedule?.date ?? "9999-12-31";
}

export function filterAndSortPersonalRecords(
  records: PersonalRecord[],
  options: PersonalRecordListOptions = {},
): PersonalRecord[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  const kind = options.kind ?? "all";
  const status = options.status ?? "all";
  const timing = options.timing ?? "all";
  const sort = options.sort ?? "updated";
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  return records
    .filter((record) => {
      if (kind !== "all" && record.kind !== kind) return false;
      if (status !== "all" && record.status !== status) return false;
      if (timing === "scheduled" && !record.schedule) return false;
      if (timing === "unscheduled" && record.schedule) return false;
      if (timing === "upcoming" && (!record.schedule || record.schedule.date < today)) return false;
      if (timing === "past" && (!record.schedule || record.schedule.date >= today)) return false;
      if (!query) return true;
      return [
        record.title,
        record.body,
        record.mood ?? "",
        record.schedule?.name ?? "",
        record.schedule?.type ?? "",
        ...record.tags,
      ].some((value) => value.toLocaleLowerCase().includes(query));
    })
    .sort((a, b) => {
      if (sort === "created") {
        return b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title, "en");
      }
      if (sort === "scheduled") {
        return (
          scheduleDate(a).localeCompare(scheduleDate(b))
          || b.updatedAt.localeCompare(a.updatedAt)
          || a.title.localeCompare(b.title, "en")
        );
      }
      if (sort === "title") {
        return a.title.localeCompare(b.title, "en") || b.updatedAt.localeCompare(a.updatedAt);
      }
      return b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, "en");
    });
}

export function summarizePersonalRecords(records: PersonalRecord[]): PersonalRecordSummary {
  return {
    total: records.length,
    active: records.filter((record) => record.status === "active").length,
    scheduled: records.filter((record) => Boolean(record.schedule)).length,
    shared: records.filter((record) => (
      record.share.status === "shared" || record.personalCalendarShare?.status === "shared"
    )).length,
  };
}
