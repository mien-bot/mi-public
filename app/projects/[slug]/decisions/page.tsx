import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getMeetingNotes,
  getProject,
  getProjectDecisions,
  getProjectSlugs,
} from "@/lib/content";
import {
  ProjectDecisionWorkspace,
  type MeetingDecisionCandidate,
} from "@/components/ProjectDecisionWorkspace";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function DecisionsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) notFound();
  const project = getProject(slug);
  const meetingCandidates: MeetingDecisionCandidate[] = getMeetingNotes(slug).flatMap(
    (meeting) => meeting.decisions.map((text, index) => ({
      id: `decision-${index + 1}`,
      text,
      meetingTitle: meeting.title,
      meetingDate: meeting.date,
      meetingPath: `meetings/${meeting.date}-${meeting.id}.md`,
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">← {project.meta.name}</Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">Decisions</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          A durable register of proposals, confirmed outcomes, their sources, and later replacements.
        </p>
      </div>
      <ProjectDecisionWorkspace
        slug={slug}
        initialDocuments={getProjectDecisions(slug)}
        meetingCandidates={meetingCandidates}
      />
    </div>
  );
}
