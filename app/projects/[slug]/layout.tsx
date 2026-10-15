import Link from "next/link";
import { detectProjectConflicts, getProject, getProjectSlugs } from "@/lib/content";
import { DataConflictBanner } from "@/components/DataConflictBanner";
import { ProjectPageGuide } from "@/components/ProjectPageGuide";
import { CurrentProjectWorkspaceNav } from "@/components/ProjectWorkspaceNav";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const known = getProjectSlugs().includes(slug);
  const conflicts = known ? detectProjectConflicts(slug) : [];
  return (
    <div className="flex flex-col gap-5">
      {/* Right-aligned and pulled tight so the page's own "← <project name>" link becomes the
          top-left element -- the frequent, in-project move reads first, and leaving the
          portfolio sits out of the way. */}
      <div className="-mb-1 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Project</p><p className="font-medium">{known ? getProject(slug).meta.name : slug}</p></div>
        <Link
          href="/projects"
          className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
        >
          ← Back to projects
        </Link>
      </div>
      <DataConflictBanner conflicts={conflicts} />
      <CurrentProjectWorkspaceNav slug={slug} />
      <ProjectPageGuide />
      {children}
    </div>
  );
}
