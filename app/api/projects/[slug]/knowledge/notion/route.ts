import { NextResponse } from "next/server";
import { getProjectSlugs } from "@/lib/content/projects";
import { projectKnowledgeExport } from "@/lib/content/projectKnowledgeExport";
import { previewKnowledgePublish, publishProjectKnowledge } from "@/src/services/projectKnowledgeNotion";
import { isWriteAllowed } from "@/src/policies/approvals";
import { loadMiConfig, patchMiConfig } from "@/src/config";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || !["preview", "publish", "enable"].includes(body.action)) return NextResponse.json({ error: "Choose preview or publish." }, { status: 400 });
  try {
    if (body.action === "enable") {
      if (body.confirmed !== true) return NextResponse.json({ error: "Explicit confirmation is required to enable knowledge publishing." }, { status: 409 });
      const allowed = loadMiConfig().notion.allowed_write_fields;
      patchMiConfig({ allowed_write_fields: { ...allowed, project: [...new Set([...(allowed.project ?? []), "knowledge"])] } });
      return NextResponse.json({ enabled: true });
    }
    if (!isWriteAllowed("project", "knowledge")) return NextResponse.json({ error: "Project knowledge publishing is disabled in this installation's Notion write settings (project: knowledge)." }, { status: 403 });
    const { project, entries } = projectKnowledgeExport(slug);
    if (!project.meta.notion_page_id) return NextResponse.json({ error: "Link the exact Notion project page before publishing knowledge." }, { status: 409 });
    if (body.action === "preview") return NextResponse.json({ plan: await previewKnowledgePublish(project.meta.notion_page_id, entries) });
    if (body.confirmed !== true || !body.previewPlan) return NextResponse.json({ error: "Preview and explicitly confirm this knowledge before publishing." }, { status: 409 });
    return NextResponse.json(await publishProjectKnowledge(project.meta.notion_page_id, entries, body.previewPlan));
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Knowledge publishing failed." }, { status: 409 });
  }
}
