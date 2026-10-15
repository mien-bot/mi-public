import fs from "node:fs";
import path from "node:path";
import { dump as dumpYaml } from "js-yaml";
import { getProject, getSchedule } from "@/lib/content";
import { readCurrentHash, writeFileAtomically } from "@/lib/content/atomicContentWrite";
import { PROJECTS_DIR, REPO_ROOT } from "@/lib/content/paths";
import type { Milestone, ProjectStatus, Schedule } from "@/lib/schema";
import { projectStatusSchema, scheduleSchema } from "@/lib/schema";
import { queryScheduleEntriesForProject, type NotionScheduleEntry } from "@/src/adapters/notion/schedule";
import {
  extractNotionProjectDetails,
  extractNotionProjectStatus,
  getStudioProjectPage,
} from "@/src/adapters/notion/studioProjects";
import { patchScalarFields } from "@/src/adapters/repo/patchYamlField";
import { isWriteAllowed } from "@/src/policies/approvals";
import { recordAudit } from "@/src/audit/log";

export interface FieldChange {
  record: "project" | "schedule";
  field: string;
  from: unknown;
  to: unknown;
  allowed: boolean;
}

export interface SyncPlan {
  slug: string;
  changes: FieldChange[];
  applied: boolean;
}

interface Snapshot {
  pulled_at: string;
  status: ProjectStatus;
  milestoneEntries: NotionScheduleEntry[];
}

const MILESTONE_TYPES = new Set(["Deadline", "Midterm Deadline", "Kick-off"]);

function snapshotPath(slug: string): string {
  return path.join(REPO_ROOT, ".mi", "notion", `${slug}.snapshot.json`);
}

function readSnapshot(slug: string): Snapshot | null {
  const filePath = snapshotPath(slug);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Snapshot;
}

function writeSnapshot(slug: string, snapshot: Snapshot): void {
  const filePath = snapshotPath(slug);
  writeFileAtomically(filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

/** Notion deadline/kick-off entries mapped onto schedule.yaml milestones, matched by notion_event_id. */
export function planMilestoneChanges(
  existing: Schedule,
  milestoneEntries: NotionScheduleEntry[],
  observedDate: string = new Date().toISOString().slice(0, 10),
): { updatedMilestones: Milestone[]; changes: FieldChange[] } {
  const changes: FieldChange[] = [];
  const bySlugId = new Map(existing.milestones.map((m) => [m.notion_event_id, m] as const));
  const updatedMilestones = [...existing.milestones];

  for (const entry of milestoneEntries) {
    const current = bySlugId.get(entry.id);
    if (!current) {
      changes.push({
        record: "schedule",
        field: "planned_date",
        from: null,
        to: { new_milestone: entry.name, planned_date: entry.date },
        allowed: isWriteAllowed("schedule", "planned_date"),
      });
      if (isWriteAllowed("schedule", "planned_date") && entry.date) {
        updatedMilestones.push({
          id: `notion-${entry.id}`,
          name: entry.name,
          planned_date: entry.date,
          actual_date: null,
          notion_event_id: entry.id,
        });
      }
      continue;
    }
    if (entry.date && current.planned_date !== entry.date) {
      changes.push({
        record: "schedule",
        field: "planned_date",
        from: current.planned_date,
        to: entry.date,
        allowed: isWriteAllowed("schedule", "planned_date"),
      });
      if (isWriteAllowed("schedule", "planned_date")) {
        const idx = updatedMilestones.findIndex((m) => m.notion_event_id === entry.id);
        if (idx >= 0) updatedMilestones[idx] = { ...updatedMilestones[idx], planned_date: entry.date };
      }
    }
    if (entry.status === "Done" || entry.status === "In progress" || entry.status === "Not started") {
      const actualDate = entry.status === "Done"
        ? entry.completedDate?.slice(0, 10) ?? current.actual_date ?? observedDate
        : null;
      if (current.actual_date !== actualDate) {
        changes.push({
          record: "schedule",
          field: "actual_date",
          from: current.actual_date,
          to: actualDate,
          allowed: isWriteAllowed("schedule", "actual_date"),
        });
        if (isWriteAllowed("schedule", "actual_date")) {
          const idx = updatedMilestones.findIndex((m) => m.notion_event_id === entry.id);
          if (idx >= 0) updatedMilestones[idx] = { ...updatedMilestones[idx], actual_date: actualDate };
        }
      }
    }
  }

  return { updatedMilestones, changes };
}

/**
 * Pulls Notion data for one project: fetch -> normalize -> diff against the
 * last snapshot -> print/return a plan -> (if apply) write only allowlisted
 * fields, refresh the snapshot, and record an audit entry. Never writes to
 * Notion itself in this build.
 */
export async function pullProjectFromNotion(slug: string, opts: { apply: boolean }): Promise<SyncPlan> {
  const project = getProject(slug);
  if (!project.meta.notion_page_id) {
    throw new Error(`projects/${slug} has no notion_page_id — run "npm run mi -- notion link ${slug}" first.`);
  }

  const lastSnapshot = readSnapshot(slug);
  const projectFilePath = path.join(PROJECTS_DIR, slug, "project.yaml");
  const scheduleFilePath = path.join(PROJECTS_DIR, slug, "schedule", "schedule.yaml");
  const projectHashBeforeFetch = readCurrentHash(projectFilePath);
  const scheduleHashBeforeFetch = readCurrentHash(scheduleFilePath);
  console.log(
    lastSnapshot ? `Last pulled ${lastSnapshot.pulled_at}.` : `No prior pull recorded for projects/${slug}.`,
  );

  const scheduleEntries = await queryScheduleEntriesForProject(project.meta.notion_page_id);
  const milestoneEntries = scheduleEntries.filter((entry) =>
    entry.type.some((type) => MILESTONE_TYPES.has(type)),
  );

  const existingSchedule = getSchedule(slug, { includeArchived: true });
  const { updatedMilestones, changes } = planMilestoneChanges(existingSchedule, milestoneEntries);

  const notionProjectPage = await getStudioProjectPage(project.meta.notion_page_id);
  const notionDetails = extractNotionProjectDetails(notionProjectPage);
  const notionStatus = extractNotionProjectStatus(notionProjectPage);
  let nextStatus: ProjectStatus = project.meta.status;
  if (notionStatus && notionStatus !== project.meta.status) {
    const parsedStatus = projectStatusSchema.safeParse(notionStatus);
    if (parsedStatus.success) {
      changes.push({
        record: "project",
        field: "status",
        from: project.meta.status,
        to: parsedStatus.data,
        allowed: isWriteAllowed("project", "status"),
      });
      if (isWriteAllowed("project", "status")) nextStatus = parsedStatus.data;
    }
  }

  for (const [field, from, to] of [
    ["client", project.meta.client, notionDetails.client],
    ["address", project.meta.address, notionDetails.location],
  ] as const) {
    if (from === to) continue;
    changes.push({
      record: "project",
      field,
      from,
      to,
      allowed: isWriteAllowed("project", field),
    });
  }

  const plan: SyncPlan = { slug, changes, applied: false };

  console.log(`\nNotion pull plan for projects/${slug} (${changes.length} change(s)):`);
  for (const change of plan.changes) {
    const gate = change.allowed ? "" : "  [not in mi.config.yaml allowed_write_fields — display only]";
    console.log(`  - ${change.record}.${change.field}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}${gate}`);
  }
  if (changes.length === 0) console.log("  (no changes)");

  if (!opts.apply) {
    console.log("\nDry run — no files written. Re-run with --apply to write allowlisted changes.");
    return plan;
  }

  const nextSchedule = scheduleSchema.parse({ milestones: updatedMilestones });
  if (changes.some((change) => change.record === "schedule" && change.allowed)) {
    writeFileAtomically(scheduleFilePath, dumpYaml(nextSchedule, { lineWidth: 100 }), {
      expectedHash: scheduleHashBeforeFetch,
    });
  }

  const projectFields: Record<string, string> = {};
  if (nextStatus !== project.meta.status) projectFields.status = nextStatus;
  if (isWriteAllowed("project", "client") && notionDetails.client !== project.meta.client) {
    projectFields.client = JSON.stringify(notionDetails.client);
  }
  if (isWriteAllowed("project", "address") && notionDetails.location !== project.meta.address) {
    projectFields.address = JSON.stringify(notionDetails.location);
  }
  if (Object.keys(projectFields).length > 0) {
    patchScalarFields(projectFilePath, projectFields, projectHashBeforeFetch);
  }

  writeSnapshot(slug, { pulled_at: new Date().toISOString(), status: nextStatus, milestoneEntries });

  recordAudit({
    command: "notion pull --apply",
    actor: process.env.USERNAME || process.env.USER || "unknown",
    slug,
    diff: plan.changes,
    applied: true,
  });

  plan.applied = true;
  console.log(`\nApplied. ${changes.filter((c) => c.allowed).length} change(s) written.`);
  return plan;
}
