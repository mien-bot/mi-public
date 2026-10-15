import { connection } from "next/server";
import { PortfolioAnalysis } from "@/components/PortfolioAnalysis";
import { buildPortfolioSnapshot } from "@/lib/content/portfolioAnalytics";

export default async function PortfolioAnalysisPage() {
  await connection();
  const snapshot = buildPortfolioSnapshot();
  return <PortfolioAnalysis snapshot={snapshot} />;
}
