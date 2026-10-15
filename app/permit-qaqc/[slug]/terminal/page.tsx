import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceTerminal } from "@/components/WorkspaceTerminal";
import { getPermitQaqcEngagement, getPermitQaqcSlugs } from "@/lib/content";

export function generateStaticParams() {
  return getPermitQaqcSlugs().map((slug) => ({ slug }));
}

export default async function PermitQaqcTerminalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getPermitQaqcSlugs().includes(slug)) notFound();
  const { engagement } = getPermitQaqcEngagement(slug);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-light tracking-wide">Permit QAQC Terminal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A persistent desktop shell for {engagement.name}. It starts inside the generated{" "}
          <code>Mi/</code> guide folder at the exact confirmed Dropbox folder when linked, or
          this engagement&apos;s structured Mi folder otherwise -- received drawing sets and
          correspondence sit one level up (<code>..</code>).
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          This is a direct shell. Use Talk to Mi when you want read-only analysis and reviewed proposal cards.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Opening this terminal writes and refreshes that <code>Mi/</code> folder automatically, so
          a Codex/Claude agent always has the review-only rules for this engagement. Received
          drawing sets, correspondence, and hand-edited files are never touched. Use{" "}
          <Link href={`/permit-qaqc/${slug}`} className="text-link underline hover:no-underline">
            Repair/Refresh Agent Workspace
          </Link>{" "}
          on the engagement page when you want to review the exact file changes first.
        </p>
      </div>
      <div className="h-[70dvh] min-h-[34rem] lg:h-[calc(100dvh-15rem)]">
        <WorkspaceTerminal workspace={`permit-qaqc/${slug}`} />
      </div>
    </div>
  );
}
