import path from "node:path";
import { NextResponse } from "next/server";
import { getLeadSlugs, getPermitQaqcSlugs, getProjectSlugs } from "@/lib/content";
import { extractDocumentText, pastedSource } from "@/lib/content/documentText";
import { resolveFileWithinDir } from "@/lib/content/fileServing";
import { describeSource } from "@/lib/content/meetingIngest";
import { rankAttachmentCandidates, scanWorkspaceFolder } from "@/lib/content/workspaceFolderScan";
import { resolveWorkspace, workspaceKindSchema, type WorkspaceKind } from "@/lib/content/workspaceOutbox";

function knownSlug(kind: WorkspaceKind, slug: string): boolean {
  if (kind === "lead") return getLeadSlugs().includes(slug);
  if (kind === "project") return getProjectSlugs().includes(slug);
  return getPermitQaqcSlugs().includes(slug);
}

/**
 * Reads one meeting source and returns its text plus a source descriptor.
 *
 * Read-only against the workspace folder: it never moves, renames, copies, or deletes the
 * file it read. The descriptor and text go back to the client as a draft, and only a
 * confirmed meeting save records either -- attaching evidence is not itself a write.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const kind = workspaceKindSchema.safeParse(body?.kind);
  if (!kind.success) {
    return NextResponse.json({ error: "Name a workspace kind: lead, project, or permit-qaqc." }, { status: 400 });
  }
  const slug = typeof body?.slug === "string" ? body.slug : "";
  if (!slug || !knownSlug(kind.data, slug)) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }
  const capturedAt = new Date().toISOString();

  // Candidate listing: what could be attached to a meeting on this date.
  if (body?.action === "candidates") {
    const meetingDate = typeof body?.meetingDate === "string" ? body.meetingDate : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
      return NextResponse.json({ error: "Set the meeting date before looking for files." }, { status: 400 });
    }
    const scan = scanWorkspaceFolder(kind.data, slug);
    if (scan.status !== "scanned") {
      return NextResponse.json({
        candidates: [],
        folderRead: false,
        note: scan.status === "unlinked"
          ? "No Dropbox folder is linked to this record."
          : `The folder was not read: ${scan.reason}`,
      });
    }
    return NextResponse.json({
      folderRead: true,
      note: "",
      candidates: rankAttachmentCandidates(scan.files, meetingDate, { limit: 12 }).map((candidate) => ({
        relativePath: candidate.file.relativePath,
        fileName: candidate.file.fileName,
        reason: candidate.reason,
        extension: candidate.file.extension,
      })),
    });
  }

  if (typeof body?.text === "string" && body.text.trim()) {
    const extracted = pastedSource(body.text);
    const label = typeof body?.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 300)
      : `Pasted text, ${capturedAt.slice(0, 10)}`;
    return NextResponse.json({
      text: extracted.text,
      warnings: extracted.warnings,
      source: describeSource({ extracted, label, relativePath: null, capturedAt }),
    });
  }

  const relativePath = typeof body?.relativePath === "string" ? body.relativePath : "";
  if (!relativePath) {
    return NextResponse.json({ error: "Paste text or choose a file from this record's folder." }, { status: 400 });
  }

  try {
    const { workspaceRoot, dropboxPath } = resolveWorkspace(kind.data, slug);
    if (!dropboxPath) {
      return NextResponse.json({ error: "Link this record's Dropbox folder before attaching a file." }, { status: 400 });
    }
    const segments = relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
    const resolved = resolveFileWithinDir(workspaceRoot, segments);
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.message === "Invalid path" ? "That path escapes this record's folder." : "File not found." },
        { status: 400 },
      );
    }
    const extracted = await extractDocumentText(resolved.absolutePath);
    return NextResponse.json({
      text: extracted.text,
      warnings: extracted.warnings,
      source: describeSource({
        extracted,
        label: path.basename(relativePath),
        relativePath: segments.join("/"),
        capturedAt,
      }),
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "The source could not be read." },
      { status: 400 },
    );
  }
}
