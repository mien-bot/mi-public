import { NextResponse } from "next/server";
import { getProject, getProjectDetails, getProjectSlugs, getSchedule } from "@/lib/content";

/**
 * Read-only support endpoint for components/ProjectInterviewPanel.tsx.
 *
 * The guided interview runs as a persistent client component mounted outside
 * any specific project route (see ChatWidget.tsx's own header comment), so it
 * has no server-rendered access to a project's details.yaml/project.yaml/
 * schedule.yaml the way an ordinary project page does. This is a small,
 * dedicated GET so the panel can call components/projectInterviewSteps.ts's
 * computeInterviewSteps(details, meta, schedule) with real, current data
 * before showing which steps are already answered. It never writes anything;
 * every actual write still goes through the confirm-gated
 * app/api/projects/[slug]/copilot/route.ts exactly like free-form chat.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const project = getProject(slug);
  const details = getProjectDetails(slug);
  const schedule = getSchedule(slug);
  return NextResponse.json({ details, meta: project.meta, schedule });
}
