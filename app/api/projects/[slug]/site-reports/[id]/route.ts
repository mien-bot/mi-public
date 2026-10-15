import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  deleteProjectSiteReport,
  getProjectSlugs,
  mirrorProjectKnowledge,
  updateProjectSiteReport,
} from "@/lib/content";
import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import { projectSiteReportIdSchema, projectSiteReportSchema } from "@/lib/schema";
import { recordAudit } from "@/src/audit/log";

function refreshSiteReportViews(slug: string) {
  revalidatePath(`/projects/${slug}`);
  revalidatePath(`/projects/${slug}/site-reports`);
  revalidatePath("/search");
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id: rawId } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const id = projectSiteReportIdSchema.safeParse(rawId);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid site-report id." }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  if (typeof body?.expectedHash !== "string" || body.expectedHash.length === 0) {
    return NextResponse.json({ error: "The current record hash is required." }, { status: 400 });
  }
  const parsed = projectSiteReportSchema.safeParse({
    ...body?.report,
    updated_at: new Date().toISOString(),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid site report." },
      { status: 400 },
    );
  }

  try {
    const document = updateProjectSiteReport(
      slug,
      id.data,
      parsed.data,
      body.expectedHash,
    );
    let mirror: ReturnType<typeof mirrorProjectKnowledge> | { mirrored: false; error: string };
    try {
      mirror = mirrorProjectKnowledge(slug);
    } catch (cause) {
      mirror = {
        mirrored: false,
        error: cause instanceof Error ? cause.message : "Dropbox Mi mirror failed.",
      };
    }
    recordAudit({
      command: "project site report update",
      actor: process.env.USERNAME || process.env.USER || "unknown",
      slug,
      diff: {
        id: document.report.id,
        status: document.report.status,
        visit_date: document.report.visit_date,
        item_count: document.report.items.length,
        photo_reference_count: document.report.items.reduce(
          (count, item) => count + item.photo_refs.length,
          0,
        ),
      },
      applied: true,
    });
    refreshSiteReportViews(slug);
    return NextResponse.json({ saved: true, document, mirror });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json(
        { error: "conflict", currentHash: cause.currentHash },
        { status: 409 },
      );
    }
    const message = cause instanceof Error ? cause.message : "The site report could not be updated.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

/**
 * Removes a site report. A report filed against the wrong project, or a duplicate from a
 * double-submit, is not an observation of anything and previously had no way back out.
 * Confirmation plus the record's hash; the file is backed up before removal.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id: rawId } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const id = projectSiteReportIdSchema.safeParse(rawId);
  if (!id.success) {
    return NextResponse.json({ error: "Invalid site-report id." }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  if (typeof body?.expectedHash !== "string" || body.expectedHash.length === 0) {
    return NextResponse.json({ error: "The current record hash is required." }, { status: 400 });
  }

  try {
    const { report, backupPath } = deleteProjectSiteReport(slug, id.data, body.expectedHash);
    recordAudit({
      command: "project site report delete",
      actor: process.env.USERNAME || process.env.USER || "unknown",
      slug,
      diff: { id: report.id, status: report.status, visit_date: report.visit_date },
      applied: true,
    });

    let mirror: ReturnType<typeof mirrorProjectKnowledge> | { mirrored: false; error: string };
    try {
      mirror = mirrorProjectKnowledge(slug);
    } catch (cause) {
      mirror = {
        mirrored: false,
        error: cause instanceof Error ? cause.message : "Dropbox Mi mirror failed.",
      };
    }
    refreshSiteReportViews(slug);
    return NextResponse.json({ deleted: true, id: report.id, backupPath, mirror });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json({ error: "conflict", currentHash: cause.currentHash }, { status: 409 });
    }
    const message = cause instanceof Error ? cause.message : "The site report could not be deleted.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
