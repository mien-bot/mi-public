import { NextResponse } from "next/server";
import { applyNotionTypeToProject } from "@/lib/content/schedulePortfolio";
import { scheduleTypeSchema } from "@/lib/schema";
import { getScheduleEntry, updateProjectScheduleEntry } from "@/src/adapters/notion/schedule";
import { recordAudit } from "@/src/audit/log";
import { isWriteAllowed } from "@/src/policies/approvals";

/** Changes one STUDIO Schedule row's type after a person pressed Save on that exact row. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  const type = scheduleTypeSchema.safeParse(body?.type);
  if (typeof body?.eventPageId !== "string" || !body.eventPageId || !type.success) {
    return NextResponse.json({ error: "Choose an item and a category." }, { status: 400 });
  }
  if (!isWriteAllowed("schedule", "type")) {
    return NextResponse.json({ error: "Changing Notion types is turned off in mi.config.yaml." }, { status: 409 });
  }
  try {
    const current = await getScheduleEntry(body.eventPageId);
    const others = current.type.filter((value) => !scheduleTypeSchema.safeParse(value).success);
    await updateProjectScheduleEntry({ eventPageId: body.eventPageId, types: [type.data, ...others] });
    recordAudit({
      command: "schedule confirmed type change",
      actor: process.env.USERNAME || process.env.USER || "unknown",
      slug: "firm",
      diff: [{ record: "schedule", field: "type", from: current.type, to: type.data }],
      applied: true,
    });
    // Notion has changed by now, so a local bookkeeping failure must not read as a failed change.
    let note: string | null = null;
    try { applyNotionTypeToProject(body.eventPageId, type.data); } catch {
      note = "Notion is updated. Mi could not update its project copy, so sync that project.";
    }
    return NextResponse.json({ saved: true, note });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Notion could not be updated.";
    if (message.includes("object_not_found")) {
      return NextResponse.json({ error: "This item no longer exists in Notion. Sync the calendar." }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
