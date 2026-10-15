import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getProject,
  getProjectSiteReports,
  getProjectSlugs,
} from "@/lib/content";
import { ProjectSiteReportWorkspace } from "@/components/ProjectSiteReportWorkspace";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function SiteReportsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) notFound();
  const project = getProject(slug);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">← {project.meta.name}</Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">Site Reports</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Structured field observations, attributed information, interpretations, issues,
          follow-ups, limitations, and photo references.
        </p>
      </div>
      <ProjectSiteReportWorkspace
        slug={slug}
        initialDocuments={getProjectSiteReports(slug)}
      />
    </div>
  );
}
