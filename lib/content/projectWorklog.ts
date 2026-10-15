import fs from "node:fs";
import path from "node:path";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import { workLogSchema, type WorkLogEntry } from "@/lib/schema";
import { readCurrentHash, writeFileAtomically, type AtomicWriteOptions } from "./atomicContentWrite";
import { contentDir } from "./projects";

export function projectWorklogPath(slug: string): string {
  return path.join(contentDir(slug), "schedule", "worklog.yaml");
}

export function getProjectWorklog(slug: string): WorkLogEntry[] {
  const filePath = projectWorklogPath(slug);
  if (!fs.existsSync(filePath)) return [];
  return workLogSchema.parse(loadYaml(fs.readFileSync(filePath, "utf8")) ?? {}).entries;
}

export function getProjectWorklogWithHash(slug: string): { entries: WorkLogEntry[]; hash: string | null } {
  return { entries: getProjectWorklog(slug), hash: readCurrentHash(projectWorklogPath(slug)) };
}

export function writeProjectWorklog(
  slug: string,
  entries: WorkLogEntry[],
  options: AtomicWriteOptions = {},
): void {
  const filePath = projectWorklogPath(slug);
  const parsed = workLogSchema.parse({ entries });
  writeFileAtomically(filePath, dumpYaml(parsed, { lineWidth: 100, noRefs: true }), options);
}

export function summarizeProjectWorklog(entries: WorkLogEntry[]) {
  const confirmed = entries.filter((entry) => entry.notion_event_id);
  const byPerson: Record<string, number> = {};
  for (const entry of confirmed) {
    for (const attendee of entry.attendees) {
      byPerson[attendee] = (byPerson[attendee] ?? 0) + entry.hours;
    }
  }
  return {
    entryCount: confirmed.length,
    companyHours: Object.values(byPerson).reduce((sum, hours) => sum + hours, 0),
    byPerson,
  };
}
