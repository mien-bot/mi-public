import { redirect } from "next/navigation";
import { detectProjectConflicts, getProject, getProjectSlugs } from "@/lib/content";
import { resolveCurrentProjectSlug } from "@/lib/content/projectRedirect";
import { DataConflictBanner } from "@/components/DataConflictBanner";
import { CurrentProjectWorkspaceNav } from "@/components/ProjectWorkspaceNav";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const slugs = getProjectSlugs();
  const known = slugs.includes(slug);
  if (known) {
    const current = resolveCurrentProjectSlug(slug, (value) => {
      if (!slugs.includes(value)) return null;
      const target = getProject(value).meta.terminal_project_slug;
      return target && slugs.includes(target) ? target : null;
    });
    if (current !== slug) redirect(`/projects/${current}`);
  }
  const conflicts = known ? detectProjectConflicts(slug) : [];
  return (
    <div className="flex flex-col gap-5">
      <DataConflictBanner conflicts={conflicts} />
      <CurrentProjectWorkspaceNav slug={slug} name={known ? getProject(slug).meta.name : slug} />
      {children}
    </div>
  );
}
