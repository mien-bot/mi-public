import { notFound } from "next/navigation";
import { SingleLeadAnalysis } from "@/components/LeadAnalysis";
import { buildLeadAnalysis, getLeadSlugs } from "@/lib/content";

export default async function LeadAnalysisPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getLeadSlugs().includes(slug)) notFound();
  return <SingleLeadAnalysis snapshot={buildLeadAnalysis(slug)} />;
}
