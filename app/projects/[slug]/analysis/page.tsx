import { notFound } from "next/navigation";
import { ProjectAnalysis } from "@/components/ProjectAnalysis";
import {
  detectProjectConflicts,
  getProjectDecisions,
  getProjectPortfolioIntelligence,
  getProjectSiteReports,
  getProjectSlugs,
  listAgentProposalInbox,
} from "@/lib/content";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}
export default async function ProjectAnalysisPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) notFound();
  const intelligence = getProjectPortfolioIntelligence(slug);
  const agentDraftCount = listAgentProposalInbox(slug)
    .reduce((sum, record) => sum + record.pendingProposals.length, 0);
  return <ProjectAnalysis
    {...intelligence}
    agentDraftCount={agentDraftCount}
    decisionCount={getProjectDecisions(slug).length}
    siteReportCount={getProjectSiteReports(slug).length}
    conflictCount={detectProjectConflicts(slug).length}
    sharedContent={intelligence.records.project.meta.content_location === "dropbox"}
  />;
}
