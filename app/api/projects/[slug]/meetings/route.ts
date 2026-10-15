import path from "node:path";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  deleteMeetingNote,
  getProjectSlugs,
  isValidIanaTimezone,
  mirrorProjectKnowledge,
  updateMeetingNote,
  writeMeetingNote,
} from "@/lib/content";
import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import { PROJECTS_DIR } from "@/lib/content/paths";
import { meetingNoteSchema } from "@/lib/schema";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const body = await request.json().catch(() => null);
  const operation = body?.operation ?? "create";
  if (operation !== "create" && operation !== "update") {
    return NextResponse.json({ error: "Unknown meeting operation." }, { status: 400 });
  }
  const parsed = meetingNoteSchema.safeParse(body?.meeting);
  if (!parsed.success || !isValidIanaTimezone(parsed.data?.timezone ?? "")) {
    return NextResponse.json({ error: parsed.success ? "Select a valid IANA timezone." : parsed.error.issues[0]?.message }, { status: 400 });
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
  let filePath: string;
  try {
    filePath = operation === "update"
      ? updateMeetingNote(slug, parsed.data, body.expectedHash)
      : writeMeetingNote(slug, parsed.data);
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json(
        { error: "This meeting changed after you opened it. Reload it and review the newer version before trying again." },
        { status: 409 },
      );
    }
    throw cause;
  }
  let mirror: ReturnType<typeof mirrorProjectKnowledge> | { mirrored: false; error: string };
  try {
    mirror = mirrorProjectKnowledge(slug);
  } catch (cause) {
    mirror = {
      mirrored: false,
      error: cause instanceof Error ? cause.message : "Dropbox Mi mirror failed.",
    };
  }
  revalidatePath(`/projects/${slug}/meetings`);
  return NextResponse.json({
    saved: true,
    updated: operation === "update",
    file: path.relative(PROJECTS_DIR, filePath).split(path.sep).join("/"),
    mirror,
  });
}

/**
 * Removes a meeting note.
 *
 * Same guards as every other destructive route in the app: explicit confirmation, plus the
 * note's hash so a page opened before someone else's edit cannot discard it. The content
 * layer copies the file into `.mi-backups/` before removal, so this is recoverable.
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
    return NextResponse.json({ error: "A meeting id is required." }, { status: 400 });
  }
  if (typeof body?.expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedHash)) {
    return NextResponse.json(
      { error: "Reload this meeting before deleting it so Mi can verify no one else changed it." },
      { status: 409 },
    );
  }

  let result: ReturnType<typeof deleteMeetingNote>;
  try {
    result = deleteMeetingNote(slug, body.id, body.expectedHash);
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

  let mirror: ReturnType<typeof mirrorProjectKnowledge> | { mirrored: false; error: string };
  try {
    mirror = mirrorProjectKnowledge(slug);
  } catch (cause) {
    mirror = {
      mirrored: false,
      error: cause instanceof Error ? cause.message : "Dropbox Mi mirror failed.",
    };
  }
  revalidatePath(`/projects/${slug}/meetings`);
  return NextResponse.json({ deleted: true, id: result.meeting.id, backupPath: result.backupPath, mirror });
}
