import Link from "next/link";
import { notFound } from "next/navigation";
import { DropboxHealthPanel } from "@/components/DropboxHealthPanel";
import { ProjectContentMigration } from "@/components/ProjectContentMigration";
import {
  getProject,
  getProjectDropboxDir,
  getProjectSlugs,
} from "@/lib/content";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function DropboxPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getProjectSlugs());
  if (!slugs.has(slug)) notFound();

  const project = getProject(slug);
  const dropboxDir = getProjectDropboxDir(project.meta);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← {project.meta.name}
        </Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">Dropbox Files</h1>
      </div>

      {!dropboxDir && (
        <p className="text-sm text-muted-foreground">
          No Dropbox folder linked. Set <code>dropbox_path</code> in this project&apos;s{" "}
          <code>project.yaml</code> (relative to your machine&apos;s <code>DROPBOX_ROOT</code> in{" "}
          <code>.env.local</code>) to browse its real files here.
        </p>
      )}
      {project.meta.dropbox_path && <DropboxHealthPanel kind="projects" slug={slug} />}
      {dropboxDir && project.meta.content_location === "dropbox" && (
        <p className="text-sm text-muted-foreground">
          This project&apos;s Mi data already lives in Dropbox
          {project.meta.content_migrated_at ? ` (migrated ${project.meta.content_migrated_at.slice(0, 10)})` : ""}.
        </p>
      )}
      {dropboxDir && project.meta.content_location !== "dropbox" && (
        <ProjectContentMigration slug={slug} />
      )}
    </div>
  );
}
