import Link from "next/link";
import { notFound } from "next/navigation";
import { getMeetingNoteRecords, getProject, getProjectSlugs } from "@/lib/content";
import { MeetingsNotesWorkspace } from "@/components/MeetingsNotesWorkspace";

export function generateStaticParams() { return getProjectSlugs().map((slug) => ({ slug })); }

export default async function MeetingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) notFound();
  const project = getProject(slug);
  return <div className="flex flex-col gap-6"><div><Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">← {project.meta.name}</Link><h1 className="mt-1 font-display text-2xl font-light tracking-wide">Meetings & Notes</h1></div><MeetingsNotesWorkspace slug={slug} notionLinked={Boolean(project.meta.notion_page_id)} records={getMeetingNoteRecords(slug)} /></div>;
}
