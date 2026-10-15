import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { deleteProject, getProjectSlugs } from "@/lib/content";
import { recordAudit } from "@/src/audit/log";

/**
 * Removes Mi's record of a project.
 *
 * Deliberately narrow, and the response says so explicitly. This deletes
 * `projects/<slug>/` — Mi's own folder — and never the project's Dropbox content folder,
 * even when the project's content lives there. Drawings, submittals and the rest of the
 * real archive are not Mi's to destroy, and AGENTS.md is explicit that Dropbox is not
 * mutated without exact assignment authority. Any linked Notion page is likewise left
 * alone; archiving it is a separate, human-confirmed action.
 *
 * Because this removes a whole folder rather than one record, it asks for the project's
 * exact name back first. The folder is copied into `.mi-backups/` before removal.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  if (typeof body?.expectedName !== "string" || body.expectedName.length === 0) {
    return NextResponse.json(
      { error: "Type the project's exact name to confirm deletion." },
      { status: 400 },
    );
  }

  try {
    const result = deleteProject(slug, { confirmed: true, expectedName: body.expectedName });
    recordAudit({
      command: "project delete",
      actor: process.env.USERNAME || process.env.USER || "unknown",
      slug,
      diff: {
        name: result.meta.name,
        status: result.meta.status,
        dropbox_content_left_in_place: result.dropboxContentLeftInPlace,
        notion_page_left_in_place: result.notionPageLeftInPlace,
      },
      applied: true,
    });
    revalidatePath("/projects");
    revalidatePath("/search");
    return NextResponse.json({
      deleted: true,
      slug: result.slug,
      name: result.meta.name,
      backupPath: result.backupPath,
      dropboxContentLeftInPlace: result.dropboxContentLeftInPlace,
      notionPageLeftInPlace: result.notionPageLeftInPlace,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The project could not be deleted.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
