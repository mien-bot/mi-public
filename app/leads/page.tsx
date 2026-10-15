import { LeadsBrowser, type LeadListEntry } from "@/components/LeadsBrowser";
import { getAllLeads, getProjectSlugs } from "@/lib/content";
import { detectFirmDataConflicts } from "@/lib/content/paths";
import { DataConflictBanner } from "@/components/DataConflictBanner";
import Link from "next/link";
import { WorkspaceIntro } from "@/components/WorkspaceIntro";
import { AppIcon } from "@/components/AppIcon";

export default function LeadsPage() {
  const entries: LeadListEntry[] = getAllLeads().map(({ slug, lead }) => ({
    slug,
    name: lead.name,
    source: lead.source,
    status: lead.status,
    estimatedValue: lead.estimated_value,
    dateReceived: lead.date_received,
  }));
  const { leads: conflicts } = detectFirmDataConflicts();

  return (
    <div className="flex flex-col gap-6">
      <WorkspaceIntro
        icon="leads"
        eyebrow="Business development"
        title="Leads"
        description="Keep opportunities, next follow-ups, early documents, and conversion readiness visible before they become active projects."
        actions={<Link href="/leads/analysis" className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm hover:border-accent">
          <AppIcon name="analysis" className="h-4 w-4" />
          Lead analysis
        </Link>}
      />
      <DataConflictBanner conflicts={conflicts} />
      <LeadsBrowser leads={entries} projectSlugs={getProjectSlugs()} />
    </div>
  );
}
