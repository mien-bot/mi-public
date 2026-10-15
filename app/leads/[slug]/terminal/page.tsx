import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceTerminal } from "@/components/WorkspaceTerminal";
import { getLead, getLeadSlugs } from "@/lib/content";

export default async function LeadTerminalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getLeadSlugs().includes(slug)) notFound();
  const { lead } = getLead(slug);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-light tracking-wide">Lead Terminal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A persistent desktop shell for {lead.name}. It starts inside the generated <code>Mi/</code>{" "}
          guide folder at the exact confirmed Dropbox folder when linked, or this lead&apos;s
          structured Mi folder otherwise.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          This is a direct shell. Use Talk to Mi when you want read-only analysis and reviewed
          proposal cards. <strong>Open in a pinned window</strong> moves this session into its
          own always-on-top card.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Opening this terminal writes and refreshes that <code>Mi/</code> folder automatically, so
          a Codex/Claude agent always knows what Mi is and where this lead stands. Hand-edited and
          user-authored files are never overwritten. Use{" "}
          <Link href={`/leads/${slug}`} className="text-link underline hover:no-underline">
            Repair/Refresh Agent Workspace
          </Link>{" "}
          on the lead page when you want to review the exact file changes first.
        </p>
      </div>
      <div className="h-[70dvh] min-h-[34rem] lg:h-[calc(100dvh-15rem)]">
        <WorkspaceTerminal workspace={`leads/${slug}`} />
      </div>
    </div>
  );
}
