import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import {
  clearPersonalCalendarShareReview,
  finishPersonalCalendarShare,
  loadPersonalDatabase,
  preparePersonalCalendarShare,
} from "@/lib/personal/store";
import { recordAudit } from "@/src/audit/log";

function actor(): string {
  return process.env.USERNAME || process.env.USER || "unknown";
}

function response() {
  const loaded = loadPersonalDatabase();
  return { database: loaded.database, hash: loaded.hash };
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
    if (body.operation === "prepare") {
      const prepared = preparePersonalCalendarShare(body.id, expectedHash);
      recordAudit({
        command: "personal calendar share prepared",
        actor: actor(),
        slug: "personal",
        diff: { recordId: body.id, destination: "personal-notion-calendar" },
        applied: false,
      });
      revalidatePath("/personal");
      return NextResponse.json({
        ...response(),
        syncKey: prepared.syncKey,
        schedule: prepared.record.schedule,
      });
    }
    if (body.operation === "finish") {
      if (typeof body.syncKey !== "string" || !body.syncKey) {
        return NextResponse.json({ error: "The pending share key is required." }, { status: 400 });
      }
      const result = body.result?.status === "shared"
        && typeof body.result.notionPageId === "string"
        && body.result.notionPageId
        && typeof body.result.notionUrl === "string"
        && /^https:\/\//.test(body.result.notionUrl)
        ? {
            status: "shared" as const,
            notionPageId: body.result.notionPageId,
            notionUrl: body.result.notionUrl,
          }
        : body.result?.status === "needs-review" && typeof body.result.message === "string" && body.result.message
          ? { status: "needs-review" as const, message: body.result.message }
          : null;
      if (!result) return NextResponse.json({ error: "A valid calendar result is required." }, { status: 400 });
      finishPersonalCalendarShare(body.id, body.syncKey, expectedHash, result);
      recordAudit({
        command: result.status === "shared" ? "personal calendar share confirmed" : "personal calendar share needs review",
        actor: actor(),
        slug: "personal",
        diff: { recordId: body.id, destination: "personal-notion-calendar", status: result.status },
        applied: result.status === "shared",
      });
      revalidatePath("/personal");
      return NextResponse.json(response());
    }
    if (body.operation === "clear-review") {
      if (body.resolution !== "confirmed-not-created") {
        return NextResponse.json(
          { error: "Confirm that you checked the selected personal calendar and no item was created." },
          { status: 409 },
        );
      }
      clearPersonalCalendarShareReview(body.id, expectedHash);
      revalidatePath("/personal");
      return NextResponse.json(response());
    }
    return NextResponse.json({ error: "Unknown personal-calendar share operation." }, { status: 400 });
  } catch (error) {
    if (error instanceof ContentConflictError) {
      return NextResponse.json(
        { error: "Personal data changed in another window. Refresh and review before sharing." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Personal calendar sharing failed." },
      { status: 400 },
    );
  }
}
