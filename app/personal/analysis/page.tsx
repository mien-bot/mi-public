import { connection } from "next/server";
import { PersonalAnalysis } from "@/components/PersonalAnalysis";
import { buildPersonalAnalytics } from "@/lib/personal/analytics";
import { loadPersonalDatabase } from "@/lib/personal/store";

export default async function PersonalAnalysisPage() {
  await connection();
  return <PersonalAnalysis analytics={buildPersonalAnalytics(loadPersonalDatabase().database)} />;
}
