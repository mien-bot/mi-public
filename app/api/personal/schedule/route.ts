import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import {
  clearPersonalShareReview,
  finishPersonalShare,
  loadPersonalDatabase,
  preparePersonalShare,
} from "@/lib/personal/store";
import { createPersonalScheduleEntry } from "@/src/adapters/notion/schedule";
import { recordAudit } from "@/src/audit/log";
import { isWriteAllowed } from "@/src/policies/approvals";

function actor(): string {
  return process.env.USERNAME || process.env.USER || "unknown";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || body.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "A personal record id is required." }, { status: 400 });
  }
  const expectedHash = typeof body.expectedHash === "string" || body.expectedHash === null
    ? body.expectedHash
    : undefined;
  if (expectedHash === undefined) {
    return NextResponse.json({ error: "The current personal database hash is required." }, { status: 400 });
  }

  try {
    if (body.operation === "clear-review") {
      if (body.resolution !== "confirmed-not-created") {
        return NextResponse.json(
          { error: "Confirm that you checked STUDIO Schedule and no item was created." },
          { status: 409 },
        );
      }
      const saved = clearPersonalShareReview(body.id, expectedHash);
      recordAudit({
        command: "personal plan STUDIO share review cleared",
        actor: actor(),
        slug: "personal",
        diff: { recordId: body.id, resolution: "human-confirmed-not-created" },
        applied: true,
      });
      revalidatePath("/personal");
      return NextResponse.json({ database: saved.database, hash: saved.hash });
    }
    if (!isWriteAllowed("schedule", "create")) {
      return NextResponse.json(
        { error: "Notion schedule-item creation is disabled in mi.config.yaml." },
        { status: 409 },
      );
    }
    const prepared = preparePersonalShare(body.id, expectedHash);
    const schedule = prepared.record.schedule;
    if (!schedule) throw new Error("Add and review schedule details before sharing.");
    try {
      const created = await createPersonalScheduleEntry(schedule);
      const saved = finishPersonalShare(
        prepared.record.id,
        prepared.syncKey,
        prepared.hash,
        {
          status: "shared",
          notionPageId: created.id,
          notionUrl: created.url,
        },
      );
      recordAudit({
        command: "personal plan confirmed STUDIO share",
        actor: actor(),
        slug: "personal",
        diff: {
          recordId: prepared.record.id,
          name: schedule.name,
          date: schedule.date,
          type: schedule.type,
          notionPageId: created.id,
        },
        applied: true,
      });
      revalidatePath("/personal");
      return NextResponse.json({ database: saved.database, hash: saved.hash });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Notion schedule creation failed.";
      try {
        finishPersonalShare(
          prepared.record.id,
          prepared.syncKey,
          prepared.hash,
          { status: "needs-review", message },
        );
      } catch {
        // The Notion result is ambiguous and local state also changed. Never retry automatically.
      }
      recordAudit({
        command: "personal plan STUDIO share needs review",
        actor: actor(),
        slug: "personal",
        diff: { recordId: prepared.record.id, message },
        applied: false,
      });
      return NextResponse.json(
        {
          error: "STUDIO sharing did not complete cleanly. Mi blocked automatic retry to avoid a duplicate; review the STUDIO Schedule before trying anything else.",
          database: loadPersonalDatabase().database,
          hash: loadPersonalDatabase().hash,
        },
        { status: 502 },
      );
    }
  } catch (error) {
    if (error instanceof ContentConflictError) {
      return NextResponse.json(
        { error: "Personal data changed in another window. Refresh and review before sharing." },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : "Personal plan sharing failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
