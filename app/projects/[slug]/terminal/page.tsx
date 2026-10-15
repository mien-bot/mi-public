import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceTerminal } from "@/components/WorkspaceTerminal";
import { getProject, getProjectSlugs } from "@/lib/content";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function ProjectTerminalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) notFound();
  const { meta } = getProject(slug);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-light tracking-wide">Project Terminal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Four independent sessions for {meta.name}. Use <strong>Open another terminal</strong> to
          work in separate windows that stay on top.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Switch sessions below, or focus a session marked Window. Closing a window keeps its
          shell running. Terminal commands run directly; use Talk to Mi for reviewed proposals.
        </p>
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Workspace preparation & files</summary>
          <p className="mt-2">
          Opening this terminal writes and refreshes that <code>Mi/</code> folder automatically, so
          a Codex/Claude agent always knows what Mi is and where this project stands. Hand-edited
          and user-authored files are never overwritten. Use{" "}
          <Link href={`/projects/${slug}/files`} className="text-link underline hover:no-underline">
            Repair/Refresh Agent Workspace
          </Link>{" "}
          on the Files page when you want to review the exact file changes first.
          </p>
        </details>
      </div>
      <div className="h-[70dvh] min-h-[34rem] lg:h-[calc(100dvh-15rem)]">
        <WorkspaceTerminal workspace={`projects/${slug}`} />
      </div>
    </div>
  );
}
