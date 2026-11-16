import Link from "next/link";
import { notFound } from "next/navigation";
import { getMeetingNoteRecords, getProject, getProjectSlugs } from "@/lib/content";
import { MeetingsNotesWorkspace } from "@/components/MeetingsNotesWorkspace";
import { readWorkspaceReviewSummary } from "@/lib/content/reviewInboxService";

export function generateStaticParams() { return getProjectSlugs().map((slug) => ({ slug })); }

export default async function MeetingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) notFound();
  const project = getProject(slug);
  // Notes an agent filed from a terminal wait in review; showing them here keeps them findable.
  const review = readWorkspaceReviewSummary("project", slug, { limit: 100 });
  const pendingMeetings = review.pending.filter((view) => view.card.entry_kind === "meeting");
  return <div className="flex flex-col gap-6"><div><h1 className="mt-1 font-display text-2xl font-light tracking-wide">Meetings & Notes</h1></div>{pendingMeetings.length > 0 && <section aria-label="Meetings waiting for review" className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{pendingMeetings.length} {pendingMeetings.length === 1 ? "meeting" : "meetings"} from the terminal waiting for review</p><Link href="/review" className="text-link underline">Review</Link></div><ul className="mt-1 text-muted-foreground">{pendingMeetings.map((view) => <li key={view.card.id}>{view.content?.title ?? view.card.source.file_name}</li>)}</ul></section>}<MeetingsNotesWorkspace slug={slug} notionLinked={Boolean(project.meta.notion_page_id)} records={getMeetingNoteRecords(slug)} /></div>;
}
