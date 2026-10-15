import path from "node:path";
import { notFound } from "next/navigation";
import { contentDir, discoverDocumentFolderFiles, discoverDropboxDocuments, getProject, getProjectDocuments, getProjectDropboxDir, getProjectSlugs } from "@/lib/content";
import { ProjectDocuments } from "@/components/ProjectDocuments";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function SubmissionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getProjectSlugs());
  if (!slugs.has(slug)) notFound();
  const project = getProject(slug);

  return (
    <ProjectDocuments
      slug={slug}
      folder="submissions"
      title="Submissions"
      documents={getProjectDocuments(slug, "submissions")}
      emptyHint="No reviewed submission entries yet. Use Manage project files to check the linked folder; available packages appear above."
      dropboxDocuments={discoverDropboxDocuments(getProjectDropboxDir(project.meta), "submissions")}
      dropboxFileApiBase="/api/dropbox-file"
      folderFiles={discoverDocumentFolderFiles(path.join(contentDir(slug), "submissions"))}
    />
  );
}
