import path from "node:path";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getProject, getProjectSlugs, mirrorProjectKnowledge } from "@/lib/content";
import { PROJECTS_DIR } from "@/lib/content/paths";
import { projectStatusSchema } from "@/lib/schema";
import { updateStudioProjectStatus } from "@/src/adapters/notion/studioProjects";
import { patchScalarField } from "@/src/adapters/repo/patchYamlField";
import { recordAudit } from "@/src/audit/log";
import { isWriteAllowed } from "@/src/policies/approvals";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = projectStatusSchema.safeParse(body?.status);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project status." }, { status: 400 });
  }
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }

  const project = getProject(slug);
  if (!project.meta.notion_page_id) {
    return NextResponse.json(
      { error: "This project is not linked to a Notion project." },
      { status: 409 },
    );
  }
  if (!isWriteAllowed("project", "status")) {
    return NextResponse.json(
      { error: "Notion project status writes are disabled in mi.config.yaml." },
      { status: 409 },
    );
  }

  const previousStatus = project.meta.status;
  try {
    await updateStudioProjectStatus(project.meta.notion_page_id, parsed.data);
    patchScalarField(path.join(PROJECTS_DIR, slug, "project.yaml"), "status", parsed.data);
    try { mirrorProjectKnowledge(slug); } catch (error) { console.error(error); }
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Status sync failed." },
      { status: 502 },
    );
  }

  recordAudit({
    command: "project status",
    actor: process.env.USERNAME || process.env.USER || "unknown",
    slug,
    diff: [{ record: "project", field: "status", from: previousStatus, to: parsed.data }],
    applied: true,
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${slug}`);
  return NextResponse.json({ status: parsed.data, notionSynced: true });
}
