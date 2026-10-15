import path from "node:path";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  deleteLeadMeetingNote,
  getLeadSlugs,
  isValidIanaTimezone,
  leadDir,
  updateLeadMeetingNote,
  writeLeadMeetingNote,
} from "@/lib/content";
import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import { meetingNoteSchema } from "@/lib/schema";

function portableRelativePath(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getLeadSlugs().includes(slug)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const operation = body?.operation ?? "create";
  if (operation !== "create" && operation !== "update") {
    return NextResponse.json({ error: "Unknown meeting operation." }, { status: 400 });
  }
  const parsed = meetingNoteSchema.safeParse(body?.meeting);
  if (!parsed.success || !isValidIanaTimezone(parsed.data?.timezone ?? "")) {
    return NextResponse.json(
      { error: parsed.success ? "Select a valid IANA timezone." : parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  if (operation === "update" && (typeof body?.expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedHash))) {
    return NextResponse.json({ error: "Reload this meeting before updating it so Mi can verify no one else changed it." }, { status: 409 });
  }
  if (operation === "update" && parsed.data.meeting_status !== "completed") {
    return NextResponse.json({ error: "A planned agenda can only be updated in place as a completed meeting." }, { status: 400 });
  }
  if (body?.confirmed !== true) {
    return NextResponse.json({ preview: parsed.data, operation, saved: false });
  }

  try {
    const filePath = operation === "update"
      ? updateLeadMeetingNote(slug, parsed.data, body.expectedHash)
      : writeLeadMeetingNote(slug, parsed.data);
    revalidatePath(`/leads/${slug}/meetings`);
    return NextResponse.json({
      saved: true,
      updated: operation === "update",
      file: portableRelativePath(leadDir(slug), filePath),
    });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json(
        { error: "This meeting changed after you opened it. Reload it and review the newer version before trying again." },
        { status: 409 },
      );
    }
    const message = cause instanceof Error ? cause.message : "Meeting save failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Removes a lead meeting note. Mirrors the project-meeting route exactly. */
export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getLeadSlugs().includes(slug)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  if (typeof body?.id !== "string" || body.id.length === 0) {
    return NextResponse.json({ error: "A meeting id is required." }, { status: 400 });
  }
  if (typeof body?.expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedHash)) {
    return NextResponse.json(
      { error: "Reload this meeting before deleting it so Mi can verify no one else changed it." },
      { status: 409 },
    );
  }

  try {
    const result = deleteLeadMeetingNote(slug, body.id, body.expectedHash);
    revalidatePath(`/leads/${slug}`);
    revalidatePath(`/leads/${slug}/meetings`);
    return NextResponse.json({ deleted: true, id: result.meeting.id, backupPath: result.backupPath });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json(
        { error: "This meeting changed after you opened it. Reload it before deleting." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "The meeting could not be deleted." },
      { status: 409 },
    );
  }
}
