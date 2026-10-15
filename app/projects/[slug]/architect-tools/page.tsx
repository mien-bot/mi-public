import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchitectToolsWorkspace, type TimeEvidenceCandidate } from "@/components/ArchitectToolsWorkspace";
import {
  getMeetingNotes,
  getProject,
  getProjectArchitectToolkit,
  getProjectDecisions,
  getProjectSiteReports,
  getProjectSlugs,
} from "@/lib/content";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function ArchitectToolsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) notFound();
  const project = getProject(slug);
  const evidence: TimeEvidenceCandidate[] = [
    ...getMeetingNotes(slug).map((meeting) => ({
      id: `meeting-${meeting.id}`,
      date: meeting.date,
      label: `Meeting: ${meeting.title}`,
      description: meeting.summary || `Meeting with ${meeting.attendees.join(", ")}`,
      path: `meetings/${meeting.date}-${meeting.id}.md`,
    })),
    ...getProjectDecisions(slug).map(({ decision, relativePath }) => ({
      id: decision.id,
      date: decision.decision_date,
      label: `Decision: ${decision.title}`,
      description: decision.context || decision.outcome || "Decision record activity",
      path: relativePath,
    })),
    ...getProjectSiteReports(slug).map(({ report, relativePath }) => ({
      id: report.id,
      date: report.visit_date,
      label: `Site report: ${report.title}`,
      description: report.purpose || report.scope || "Site observation activity",
      path: relativePath,
    })),
  ].sort((left, right) => right.date.localeCompare(left.date));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← {project.meta.name}
        </Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">Architect Tools</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Project-scoped occupancy, workplace, specification, product, carbon, time, and
          Chicago site-intelligence tools. Every saved result remains a cited draft until
          a qualified person reviews it.
        </p>
      </div>
      <ArchitectToolsWorkspace
        slug={slug}
        initialToolkit={getProjectArchitectToolkit(slug)}
        timeEvidence={evidence}
      />
    </div>
  );
}
