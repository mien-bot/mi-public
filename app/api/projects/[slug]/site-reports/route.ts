import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  createProjectSiteReport,
  getProjectSlugs,
  mirrorProjectKnowledge,
} from "@/lib/content";
import { projectSiteReportSchema } from "@/lib/schema";
import { recordAudit } from "@/src/audit/log";

function refreshSiteReportViews(slug: string) {
  revalidatePath(`/projects/${slug}`);
  revalidatePath(`/projects/${slug}/site-reports`);
  revalidatePath("/search");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const timestamp = new Date().toISOString();
  const parsed = projectSiteReportSchema.safeParse({
    ...body?.report,
    created_at: body?.confirmed === true
      ? timestamp
      : body?.report?.created_at ?? timestamp,
    updated_at: body?.confirmed === true
      ? timestamp
      : body?.report?.updated_at ?? timestamp,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid site report." },
      { status: 400 },
    );
  }
  if (body?.confirmed !== true) {
    return NextResponse.json({ preview: parsed.data, saved: false });
  }

  try {
    const document = createProjectSiteReport(slug, parsed.data);
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
      command: "project site report create",
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
    const message = cause instanceof Error ? cause.message : "The site report could not be saved.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
