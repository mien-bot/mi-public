import Link from "next/link";
import { notFound } from "next/navigation";
import { MeetingsNotesWorkspace } from "@/components/MeetingsNotesWorkspace";
import { MiMark } from "@/components/MiMark";
import { getLead, getLeadMeetingNoteRecords, getLeadSlugs } from "@/lib/content";

export function generateStaticParams() {
  return getLeadSlugs().map((slug) => ({ slug }));
}

export default async function LeadMeetingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getLeadSlugs().includes(slug)) notFound();
  const { lead } = getLead(slug);
  const records = getLeadMeetingNoteRecords(slug);

  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-light tracking-wide">Meetings & Notes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Site visits and pre-project meetings for {lead.name}.</p>
      </div>
      <Link href={`/leads/${slug}/chat`} className="flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm text-background">
        <MiMark className="h-4 w-4" />
        Plan or summarize with Mi
      </Link>
    </div>

    <MeetingsNotesWorkspace
      slug={slug}
      notionLinked={Boolean(lead.notion_page_id)}
      records={records}
      scope="lead"
    />

    <p className="text-xs text-muted-foreground">
      Mi saves confirmed notes inside this lead&apos;s shared firm data, which remains Dropbox-backed after firm-data migration. “Mi + Notion” also refreshes the Meeting Notes field on the already-linked lead page.
    </p>
  </div>;
}
