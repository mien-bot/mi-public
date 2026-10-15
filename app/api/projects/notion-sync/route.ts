import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getProject, getProjectSlugs } from "@/lib/content";
import { pullProjectFromNotion } from "@/src/services/notionSync";

export interface ProjectNotionSyncResult {
  slug: string;
  name: string;
  status: "ready" | "applied" | "error";
  plan?: Awaited<ReturnType<typeof pullProjectFromNotion>>;
  error?: string;
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const confirmed = body?.confirmed === true;
  const linked = getProjectSlugs()
    .map((slug) => ({ slug, project: getProject(slug) }))
    .filter(({ project }) => Boolean(project.meta.notion_page_id));
  const projects: ProjectNotionSyncResult[] = [];

  // Applying is deliberately sequential. Each project has its own conflict check and a failed
  // project must not prevent the remaining human-confirmed links from being reviewed/applied.
  for (const { slug, project } of linked) {
    try {
      const plan = await pullProjectFromNotion(slug, { apply: confirmed });
      projects.push({
        slug,
        name: project.meta.name,
        status: confirmed ? "applied" : "ready",
        plan,
      });
      if (confirmed) {
        revalidatePath(`/projects/${slug}`);
        revalidatePath(`/projects/${slug}/schedule`);
        revalidatePath(`/projects/${slug}/details`);
        revalidatePath(`/projects/${slug}/analysis`);
      }
    } catch (cause) {
      projects.push({
        slug,
        name: project.meta.name,
        status: "error",
        error: cause instanceof Error ? cause.message : "Notion synchronization failed.",
      });
    }
  }
  if (confirmed) {
    revalidatePath("/projects");
    revalidatePath("/projects/analysis");
  }
  return NextResponse.json({
    confirmed,
    projects,
    skipped: getProjectSlugs().length - linked.length,
  });
}
