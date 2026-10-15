import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  deleteProjectMilestone,
  getProject,
  getProjectSlugs,
  getSchedule,
  schedulePath,
  writeProjectSchedule,
} from "@/lib/content";
import { scheduleDraftItemSchema } from "@/lib/schema";
import { saveScheduleItemLocally, syncScheduleItems } from "@/lib/content/notionScheduleSync";
import { ContentConflictError, readCurrentHash } from "@/lib/content/atomicContentWrite";
import {
  createProjectScheduleEntry,
  getScheduleEntry,
  queryScheduleEntriesForProject,
  updateProjectScheduleEntry,
} from "@/src/adapters/notion/schedule";
import { recordAudit } from "@/src/audit/log";
import { isWriteAllowed } from "@/src/policies/approvals";
import { dateInTimezone, DEFAULT_TIMEZONE } from "@/lib/content/timezone";

function currentHash(slug: string): string | null {
  return readCurrentHash(schedulePath(slug));
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function loadProject(slug: string) {
  if (!getProjectSlugs().includes(slug)) throw new Error("Project not found.");
  return getProject(slug);
}

function refresh(slug: string) {
  revalidatePath(`/projects/${slug}/schedule`);
  revalidatePath(`/projects/${slug}`);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);

  try {
    const project = loadProject(slug);
    if (body?.operation === "sync") {
      const parsedItems = Array.isArray(body.items)
        ? body.items.map((item: unknown) => scheduleDraftItemSchema.parse(item))
        : [];
      if (parsedItems.length === 0) {
        return NextResponse.json({ error: "Select at least one schedule item." }, { status: 400 });
      }
      const confirmed = body.confirmed === true;
      if (confirmed && !isWriteAllowed("schedule", "create")) {
        return NextResponse.json(
          { error: "Notion schedule-item creation is disabled in mi.config.yaml." },
          { status: 409 },
        );
      }
      // Captured at load() time, checked at save() time -- protects against a concurrent
      // schedule write (another tab, another machine sharing this Dropbox-migrated project)
      // landing in between, same pattern the PATCH handler below already uses.
      let syncHashAtLoad: string | null = null;
      const results = await syncScheduleItems({
        confirmed,
        projectPageId: project.meta.notion_page_id,
        items: parsedItems,
        repository: {
          load: () => {
            syncHashAtLoad = currentHash(slug);
            return getSchedule(slug, { includeArchived: true }).milestones;
          },
          save: (milestones) => {
            writeProjectSchedule(slug, milestones, { expectedHash: syncHashAtLoad });
            syncHashAtLoad = currentHash(slug);
          },
        },
        adapter: {
          create: (input) => createProjectScheduleEntry(input),
        },
      });
      if (confirmed) {
        refresh(slug);
        recordAudit({
          command: "project schedule confirmed sync",
          actor: process.env.USERNAME || process.env.USER || "unknown",
          slug,
          diff: results,
          applied: true,
        });
      }
      return NextResponse.json({ confirmed, results, hash: currentHash(slug) });
    }

    if (body?.operation === "save-local") {
      if (body.confirmed !== true) {
        return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
      }
      const item = scheduleDraftItemSchema.parse(body.item);
      let saveLocalHashAtLoad: string | null = null;
      const { id } = saveScheduleItemLocally(item, {
        load: () => {
          saveLocalHashAtLoad = currentHash(slug);
          return getSchedule(slug, { includeArchived: true }).milestones;
        },
        save: (milestones) => writeProjectSchedule(slug, milestones, { expectedHash: saveLocalHashAtLoad }),
      });
      refresh(slug);
      return NextResponse.json({ saved: true, id, hash: currentHash(slug) });
    }

    if (body?.operation === "refresh-notion-status") {
      if (body.confirmed !== true) {
        return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
      }
      if (!project.meta.notion_page_id) {
        return NextResponse.json({ error: "This project is not linked to Notion." }, { status: 409 });
      }
      const entries = await queryScheduleEntriesForProject(project.meta.notion_page_id);
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      // Captured at the same moment as the read below -- protects the conditional write further
      // down from a concurrent schedule edit landing in between.
      const hashAtLoad = currentHash(slug);
      const schedule = getSchedule(slug, { includeArchived: true });
      let matched = 0;
      let changed = 0;
      let observedCompletionDates = 0;
      const today = dateInTimezone(new Date(), process.env.MI_TIMEZONE || DEFAULT_TIMEZONE);
      const milestones = schedule.milestones.map((milestone) => {
        if (!milestone.notion_event_id) return milestone;
        const entry = byId.get(milestone.notion_event_id);
        if (!entry || !entry.status) return milestone;
        matched += 1;
        let actualDate = milestone.actual_date;
        if (entry.status === "Done") {
          actualDate = entry.completedDate?.slice(0, 10) ?? milestone.actual_date ?? today;
          if (!entry.completedDate && !milestone.actual_date) observedCompletionDates += 1;
        } else if (entry.status === "In progress" || entry.status === "Not started") {
          actualDate = null;
        } else {
          return milestone;
        }
        if (actualDate === milestone.actual_date) return milestone;
        changed += 1;
        return { ...milestone, actual_date: actualDate };
      });
      if (changed > 0) writeProjectSchedule(slug, milestones, { expectedHash: hashAtLoad });
      recordAudit({
        command: "project schedule confirmed Notion status refresh",
        actor: process.env.USERNAME || process.env.USER || "unknown",
        slug,
        diff: { matched, changed, observedCompletionDates },
        applied: changed > 0,
      });
      refresh(slug);
      return NextResponse.json({ refreshed: true, matched, changed, observedCompletionDates, hash: currentHash(slug) });
    }

    return NextResponse.json({ error: "Unknown schedule operation." }, { status: 400 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Schedule request failed.";
    const status = message === "Project not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  const id = typeof body?.id === "string" ? body.id : "";
  const actualDate = body?.actualDate === null || body?.actualDate === "" ? null : body?.actualDate;
  if (!id || !validDate(body?.plannedDate) || (actualDate !== null && !validDate(actualDate))) {
    return NextResponse.json({ error: "A milestone and valid planned/actual dates are required." }, { status: 400 });
  }

  if (!("expectedHash" in body) || (body.expectedHash !== null && typeof body.expectedHash !== "string")) {
    return NextResponse.json({ error: "Reload this schedule before saving so Mi can verify no one else changed it." }, { status: 409 });
  }
  const expectedHash: string | null = body.expectedHash;
  try {
    const project = loadProject(slug);
    // Check for drift before any Notion call -- writeProjectSchedule's own expectedHash
    // check below is a defense-in-depth backstop, but by then a Notion update (if
    // syncNotion) would already be irreversible, so the conflict must be caught here first.
    if (currentHash(slug) !== expectedHash) {
      return NextResponse.json({ error: "conflict", currentHash: currentHash(slug) }, { status: 409 });
    }
    const schedule = getSchedule(slug, { includeArchived: true });
    const index = schedule.milestones.findIndex((item) => item.id === id);
    if (index < 0) return NextResponse.json({ error: "Milestone not found." }, { status: 404 });
    const milestone = schedule.milestones[index];
    const plannedDateChanged = body.plannedDate !== milestone.planned_date;
    const actualDateChanged = actualDate !== milestone.actual_date;
    if (body.syncNotion === true) {
      if (!project.meta.notion_page_id || !milestone.notion_event_id) {
        return NextResponse.json({ error: "This milestone is not linked to Notion." }, { status: 409 });
      }
      const plannedDateWriteBlocked = plannedDateChanged && !isWriteAllowed("schedule", "planned_date");
      const actualDateWriteBlocked = actualDateChanged && !isWriteAllowed("schedule", "actual_date");
      if (plannedDateWriteBlocked || actualDateWriteBlocked) {
        return NextResponse.json(
          { error: "Notion schedule writes are disabled in mi.config.yaml." },
          { status: 409 },
        );
      }
      const current = await getScheduleEntry(milestone.notion_event_id);
      const currentDate = current.date?.slice(0, 10) ?? null;
      const currentCompletedDate = current.completedDate?.slice(0, 10) ?? null;
      if (plannedDateChanged && currentDate !== milestone.planned_date) {
        return NextResponse.json(
          { error: `Notion now has this milestone on ${currentDate ?? "no date"}. Refresh from Notion and review the change again.` },
          { status: 409 },
        );
      }
      if (plannedDateChanged && (current.startTime || current.endTime)) {
        return NextResponse.json(
          { error: "Move timed milestones from the STUDIO Schedule calendar so Mi can review Date, Start Time, and End Time together." },
          { status: 409 },
        );
      }
      const notionCompletionMatchesLocal = milestone.actual_date
        ? current.status === "Done" && currentCompletedDate === milestone.actual_date
        : current.status !== "Done" && currentCompletedDate === null;
      if (actualDateChanged && !notionCompletionMatchesLocal) {
        return NextResponse.json(
          { error: "Notion completion changed since Mi loaded this milestone. Refresh from Notion and review the change again." },
          { status: 409 },
        );
      }
      await updateProjectScheduleEntry({
        eventPageId: milestone.notion_event_id,
        date: plannedDateChanged ? body.plannedDate : undefined,
        status: actualDateChanged ? (actualDate ? "Done" : "In progress") : undefined,
        completedDate: actualDateChanged ? actualDate : undefined,
      });
      recordAudit({
        command: "project schedule confirmed milestone update",
        actor: process.env.USERNAME || process.env.USER || "unknown",
        slug,
        diff: [
          { record: "schedule", field: "planned_date", from: milestone.planned_date, to: body.plannedDate },
          { record: "schedule", field: "actual_date", from: milestone.actual_date, to: actualDate },
        ],
        applied: true,
      });
    }
    schedule.milestones[index] = {
      ...milestone,
      planned_date: body.plannedDate,
      actual_date: actualDate,
    };
    writeProjectSchedule(slug, schedule.milestones, { expectedHash });
    refresh(slug);
    return NextResponse.json({
      updated: true,
      notionUpdated: body.syncNotion === true,
      completionStatus: actualDate ? "complete" : "in-progress",
      hash: currentHash(slug),
    });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json({ error: "conflict", currentHash: cause.currentHash }, { status: 409 });
    }
    const message = cause instanceof Error ? cause.message : "Schedule update failed.";
    return NextResponse.json({ error: message }, { status: message === "Project not found." ? 404 : 502 });
  }
}

/**
 * Removes one milestone from the schedule.
 *
 * A milestone linked to a Notion row is refused by the content layer: Mi's copy mirrors a
 * row that still exists over there, and dropping it locally would only make the next sync
 * look like a mysterious re-appearance. The file hash guards the read-modify-write.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  if (typeof body?.id !== "string" || body.id.length === 0) {
    return NextResponse.json({ error: "A milestone id is required." }, { status: 400 });
  }

  try {
    const milestone = deleteProjectMilestone(slug, body.id, body?.expectedHash ?? currentHash(slug));
    recordAudit({
      command: "project milestone delete",
      actor: process.env.USERNAME || process.env.USER || "unknown",
      slug,
      diff: { id: milestone.id, name: milestone.name, planned_date: milestone.planned_date },
      applied: true,
    });
    refresh(slug);
    return NextResponse.json({ deleted: true, milestone, hash: currentHash(slug) });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json(
        { error: "The schedule changed after you opened it. Reload before deleting." },
        { status: 409 },
      );
    }
    const message = cause instanceof Error ? cause.message : "The milestone could not be deleted.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
