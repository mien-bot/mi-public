import { notFound } from "next/navigation";
import { LeadTalkWorkspace } from "@/components/LeadTalkWorkspace";
import { MiMark } from "@/components/MiMark";
import { getLead, getLeadSlugs } from "@/lib/content";

export function generateStaticParams() {
  return getLeadSlugs().map((slug) => ({ slug }));
}

export default async function LeadChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ newChat?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  if (!getLeadSlugs().includes(slug)) notFound();
  const { lead } = getLead(slug);

  return <div className="flex flex-col gap-4">
    <div>
      <div className="flex items-center gap-2">
        <MiMark gradient className="h-7 w-7" />
        <h1 className="font-display text-2xl font-light tracking-wide">Talk to Mi</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Chat, meeting summaries, and proposed updates stay inside {lead.name}.
      </p>
    </div>
    <LeadTalkWorkspace
      slug={slug}
      name={lead.name}
      notionLinked={Boolean(lead.notion_page_id)}
      startFresh={query.newChat === "1"}
    />
  </div>;
}
