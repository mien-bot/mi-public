import { connection } from "next/server";
import { LeadPipelineAnalysisView } from "@/components/LeadAnalysis";
import { buildLeadPipelineAnalysis } from "@/lib/content";

export default async function LeadPipelineAnalysisPage() {
  await connection();
  return <LeadPipelineAnalysisView analysis={buildLeadPipelineAnalysis()} />;
}
