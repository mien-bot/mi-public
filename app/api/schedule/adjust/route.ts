import { NextResponse } from "next/server";
import { scheduleCopilotProposalSchema } from "@/lib/scheduleCopilot";
import {
  createPersonalScheduleEntry,
  createProjectScheduleEntry,
  duplicateScheduleEntry,
  getScheduleEntry,
  updateScheduleEntryDate,
  trashScheduleEntry,
} from "@/src/adapters/notion/schedule";
import { scheduleTypeSchema } from "@/lib/schema";
import { recordAudit } from "@/src/audit/log";
import { isWriteAllowed } from "@/src/policies/approvals";
import { completeScheduleCreate, reserveScheduleCreate } from "@/lib/content/scheduleCreateJournal";

function actor(): string {
  return process.env.USERNAME || process.env.USER || "unknown";
}

/**
 * The journal is written *after* Notion already accepted the event, so a failure here is a
 * bookkeeping failure, not a failed create. Reporting it as an error is actively harmful: the
 * partner reads "the event could not be added", adds it again by hand, and the schedule ends up
 * with two. This is exactly what a shared Dropbox folder produced -- an EPERM on the journal
 * rename while Dropbox held the temp file open. Say what happened instead, and keep the create
 * reported as the success it was.
 */
function noteJournalFailure(
  requestId: string,
  payload: unknown,
  result: { id: string; url: string },
): string {
  try {
    completeScheduleCreate(requestId, payload, result);
    return "";
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    recordAudit({
      command: "schedule create journal not completed",
      actor: actor(),
      slug: "schedule",
      diff: { requestId, notionPageId: result.id, message: detail },
      applied: true,
    });
    return ` The event is in Notion, but Mi could not update its own record of it: ${detail}`;
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || body.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  const parsed = scheduleCopilotProposalSchema.safeParse(body.proposal);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid proposal." }, { status: 400 });
  }
  const proposal = parsed.data;

  if (proposal.kind === "schedule-remove") {
    if (!isWriteAllowed("schedule", "remove")) {
      return NextResponse.json({ error: "Schedule removal is disabled. Enable schedule.remove in this installation's mi.config.yaml before confirming." }, { status: 409 });
    }
    try {
      await trashScheduleEntry(proposal.data);
    } catch (cause) {
      return NextResponse.json({ error: cause instanceof Error ? cause.message : "The event could not be removed." }, { status: 409 });
    }
    let warning = "";
    try {
      recordAudit({ command: "schedule confirmed removal", actor: actor(), slug: "schedule", diff: proposal.data, applied: true });
    } catch {
      warning = " Mi could not save its audit record.";
    }
    return NextResponse.json({ ok: true, message: `Removed "${proposal.data.name}" from the schedule. It can be restored from Notion Trash.${warning}` });
  }

  if (proposal.kind === "schedule-reschedule") {
    const calendarDayChanged = proposal.data.currentDate !== proposal.data.newDate;
    const startTimeChanged = proposal.data.currentStartTime !== proposal.data.newStartTime;
    const endTimeChanged = proposal.data.currentEndTime !== proposal.data.newEndTime;
    const dateChanged = calendarDayChanged || startTimeChanged || endTimeChanged;
    const blockedFields = dateChanged && !isWriteAllowed("schedule", "planned_date") ? ["Date"] : [];
    if (blockedFields.length > 0) {
      return NextResponse.json(
        { error: `Notion writes are disabled for: ${blockedFields.join(", ")}.` },
        { status: 409 },
      );
    }
    try {
      const current = await getScheduleEntry(proposal.data.eventPageId);
      const currentDate = current.date?.slice(0, 10) ?? null;
      const currentStartTime = current.date?.includes("T") ? current.date : null;
      const currentEndTime = current.dateEnd ?? null;
      if (
        currentDate !== proposal.data.currentDate
        || currentStartTime !== proposal.data.currentStartTime
        || currentEndTime !== proposal.data.currentEndTime
      ) {
        recordAudit({
          command: "schedule agent stale reschedule blocked",
          actor: actor(),
          slug: "schedule",
          diff: {
            eventPageId: proposal.data.eventPageId,
            proposedFrom: proposal.data.currentDate,
            currentDate,
            proposedDateStart: proposal.data.currentStartTime,
            currentDateStart: currentStartTime,
            proposedDateEnd: proposal.data.currentEndTime,
            currentDateEnd: currentEndTime,
          },
          applied: false,
        });
        return NextResponse.json(
          { error: `Notion now has this event on ${currentDate ?? "no date"}. Sync and review the change again.` },
          { status: 409 },
        );
      }
      const update: Parameters<typeof updateScheduleEntryDate>[0] = {
        eventPageId: proposal.data.eventPageId,
      };
      if (dateChanged) {
        update.date = proposal.data.newStartTime ?? proposal.data.newDate;
        update.dateEnd = proposal.data.newEndTime;
      }
      await updateScheduleEntryDate(update);
      recordAudit({
        command: "schedule agent confirmed reschedule",
        actor: actor(),
        slug: "schedule",
        diff: {
          eventPageId: proposal.data.eventPageId,
          name: proposal.data.name,
          field: "planned_date",
          from: proposal.data.currentDate,
          to: proposal.data.newDate,
          dateStart: { from: proposal.data.currentStartTime, to: proposal.data.newStartTime },
          dateEnd: { from: proposal.data.currentEndTime, to: proposal.data.newEndTime },
        },
        applied: true,
      });
      return NextResponse.json({
        ok: true,
        message: calendarDayChanged
          ? `Moved "${proposal.data.name}" to ${proposal.data.newDate}.`
          : `Updated the time for "${proposal.data.name}".`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The reschedule could not be applied.";
      recordAudit({
        command: "schedule agent reschedule failed",
        actor: actor(),
        slug: "schedule",
        diff: { eventPageId: proposal.data.eventPageId, message },
        applied: false,
      });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (proposal.kind === "schedule-status") {
    if (!isWriteAllowed("schedule", "actual_date")) {
      return NextResponse.json({ error: "Notion schedule status writes are disabled in mi.config.yaml." }, { status: 409 });
    }
    try {
      const current = await getScheduleEntry(proposal.data.eventPageId);
      if (current.status !== proposal.data.currentStatus) {
        recordAudit({
          command: "schedule agent stale status change blocked",
          actor: actor(),
          slug: "schedule",
          diff: {
            eventPageId: proposal.data.eventPageId,
            proposedFrom: proposal.data.currentStatus,
            currentStatus: current.status,
          },
          applied: false,
        });
        return NextResponse.json(
          { error: `Notion now shows status ${current.status ?? "blank"}. Sync and review the change again.` },
          { status: 409 },
        );
      }
      await updateScheduleEntryDate({ eventPageId: proposal.data.eventPageId, status: proposal.data.newStatus });
      recordAudit({
        command: "schedule agent confirmed status change",
        actor: actor(),
        slug: "schedule",
        diff: {
          eventPageId: proposal.data.eventPageId,
          name: proposal.data.name,
          field: "status",
          from: proposal.data.currentStatus,
          to: proposal.data.newStatus,
        },
        applied: true,
      });
      return NextResponse.json({ ok: true, message: `Set "${proposal.data.name}" to ${proposal.data.newStatus}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The status change could not be applied.";
      recordAudit({
        command: "schedule agent status change failed",
        actor: actor(),
        slug: "schedule",
        diff: { eventPageId: proposal.data.eventPageId, message },
        applied: false,
      });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (proposal.kind === "schedule-duplicate") {
    if (!isWriteAllowed("schedule", "create")) {
      return NextResponse.json({ error: "Notion schedule-item creation is disabled in mi.config.yaml." }, { status: 409 });
    }
    try {
      const current = await getScheduleEntry(proposal.data.eventPageId);
      if (current.date?.slice(0, 10) !== proposal.data.currentDate || current.name !== proposal.data.name) {
        return NextResponse.json({ error: "The source event changed in Notion. Sync and Ctrl-drag it again." }, { status: 409 });
      }
      const type = scheduleTypeSchema.safeParse(current.type[0]);
      if (!type.success) {
        return NextResponse.json({ error: "This event’s Notion Type is not available for duplication in Mi." }, { status: 409 });
      }
      const reservation = reserveScheduleCreate(proposal.id, proposal.data);
      if (reservation.status === "mismatch") return NextResponse.json({ error: "This duplicate request id was already used for different details." }, { status: 409 });
      if (reservation.status === "pending-review") return NextResponse.json({ error: "A prior duplicate may have reached Notion. Sync and review before retrying." }, { status: 409 });
      if (reservation.status === "already-applied") return NextResponse.json({ ok: true, alreadyApplied: true, message: `“${proposal.data.name}” was already duplicated.` });
      const created = await duplicateScheduleEntry({
        name: current.name,
        date: proposal.data.newDate,
        type: type.data,
        startTime: proposal.data.newStartTime,
        endTime: proposal.data.newEndTime,
        projectPageIds: current.projectPageIds,
        attendeeIds: current.attendees.map((attendee) => attendee.id),
      });
      const duplicateNote = noteJournalFailure(proposal.id, proposal.data, created);
      recordAudit({
        command: "schedule calendar confirmed duplicate",
        actor: actor(),
        slug: "schedule",
        diff: { sourcePageId: proposal.data.eventPageId, notionPageId: created.id, newDate: proposal.data.newDate },
        applied: true,
      });
      return NextResponse.json({ ok: true, message: `Duplicated "${current.name}" on ${proposal.data.newDate}.${duplicateNote}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The event could not be duplicated.";
      recordAudit({ command: "schedule calendar duplicate failed", actor: actor(), slug: "schedule", diff: { message }, applied: false });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (!isWriteAllowed("schedule", "create")) {
    return NextResponse.json({ error: "Notion schedule-item creation is disabled in mi.config.yaml." }, { status: 409 });
  }
  let reservation: ReturnType<typeof reserveScheduleCreate>;
  try {
    reservation = reserveScheduleCreate(proposal.id, proposal.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mi could not reserve this schedule change safely." },
      { status: 502 },
    );
  }
  if (reservation.status === "mismatch") {
    return NextResponse.json({ error: "This schedule request id was already used for different event details." }, { status: 409 });
  }
  if (reservation.status === "pending-review") {
    return NextResponse.json(
      { error: "A prior confirmed create may have reached Notion. Review the STUDIO Schedule before retrying." },
      { status: 409 },
    );
  }
  if (reservation.status === "already-applied") {
    return NextResponse.json({ ok: true, alreadyApplied: true, message: `“${proposal.data.name}” was already added.` });
  }
  try {
    const created = proposal.data.projectPageId
      ? await createProjectScheduleEntry({
          projectPageId: proposal.data.projectPageId,
          name: proposal.data.name,
          date: proposal.data.date,
          type: proposal.data.type,
          startTime: proposal.data.startTime,
          endTime: proposal.data.endTime,
          attendeeIds: proposal.data.attendeeIds,
        })
      : await createPersonalScheduleEntry({
          name: proposal.data.name,
          date: proposal.data.date,
          type: proposal.data.type,
          startTime: proposal.data.startTime,
          endTime: proposal.data.endTime,
          attendeeIds: proposal.data.attendeeIds,
        });
    const journalNote = noteJournalFailure(proposal.id, proposal.data, created);
    recordAudit({
      command: "schedule agent confirmed new entry",
      actor: actor(),
      slug: "schedule",
      diff: {
        notionPageId: created.id,
        name: proposal.data.name,
        date: proposal.data.date,
        type: proposal.data.type,
        startTime: proposal.data.startTime,
        endTime: proposal.data.endTime,
        projectPageId: proposal.data.projectPageId,
        projectName: proposal.data.projectName,
        attendeeCount: proposal.data.attendeeIds.length,
      },
      applied: true,
    });
    return NextResponse.json({ ok: true, message: `Added "${proposal.data.name}" on ${proposal.data.date}.${journalNote}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The new entry could not be created.";
    recordAudit({
      command: "schedule agent new entry failed",
      actor: actor(),
      slug: "schedule",
      diff: { name: proposal.data.name, date: proposal.data.date, message },
      applied: false,
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
