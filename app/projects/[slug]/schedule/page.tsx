import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getProjectSlugs, getScheduleWithHash } from "@/lib/content";
import { ProjectScheduleEditor } from "@/components/ProjectScheduleEditor";
import { ProjectPlanningWorkspace } from "@/components/ProjectPlanningWorkspace";
import { ProjectNotionSyncButton } from "@/components/ProjectNotionSyncButton";
import { ProjectContractPlan } from "@/components/ProjectContractPlan";
import { getProjectDetailsWithHash } from "@/lib/content/projectWorkspace";
import { timelineRow } from "@/lib/scheduleInsights";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function SchedulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getProjectSlugs());
  if (!slugs.has(slug)) notFound();

  const project = getProject(slug);
  const { schedule, hash } = getScheduleWithHash(slug);
  const { details, hash: detailsHash } = getProjectDetailsWithHash(slug);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← {project.meta.name}
          </Link>
          <h1 className="mt-1 font-display text-2xl font-light tracking-wide">Plan & Timeline</h1>
        </div>
        {project.meta.notion_page_id && (
          <ProjectNotionSyncButton slug={slug} projectName={project.meta.name} />
        )}
      </div>
      <ProjectContractPlan slug={slug} initialDetails={details} initialHash={detailsHash} />
      <ProjectScheduleEditor
        slug={slug}
        milestones={schedule.milestones}
        initialHash={hash}
        notionLinked={Boolean(project.meta.notion_page_id)}
        row={timelineRow({ slug, name: project.meta.name }, schedule.milestones, details)}
      />
      <ProjectPlanningWorkspace slug={slug} notionLinked={Boolean(project.meta.notion_page_id)} />
    </div>
  );
}
