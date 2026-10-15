import Link from "next/link";
import { DataConflictBanner } from "@/components/DataConflictBanner";
import { LeadWorkspaceNav } from "@/components/LeadWorkspaceNav";
import { LeadSyncButton } from "@/components/LeadSyncButton";
import { getLead, getLeadSlugs } from "@/lib/content";
import { detectFirmDataConflicts } from "@/lib/content/paths";
import { notFound } from "next/navigation";

export default async function LeadLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getLeadSlugs().includes(slug)) notFound();
  const { lead } = getLead(slug);
  const { leads: conflicts } = detectFirmDataConflicts();
  return <div className="flex flex-col gap-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <Link
        href="/leads"
        className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
      >
        ← Back to leads
      </Link>
      <LeadSyncButton slug={slug} leadName={lead.name} />
    </div>
    <DataConflictBanner conflicts={conflicts} />
    <LeadWorkspaceNav slug={slug} />
    {children}
  </div>;
}
