import path from "node:path";
import { notFound } from "next/navigation";
import { contentDir, discoverDocumentFolderFiles, discoverDropboxDocuments, getProject, getProjectDocuments, getProjectDropboxDir, getProjectSlugs } from "@/lib/content";
import { ProjectDocuments } from "@/components/ProjectDocuments";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function ContractsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getProjectSlugs());
  if (!slugs.has(slug)) notFound();
  const project = getProject(slug);

  return (
    <ProjectDocuments
      slug={slug}
      folder="contracts"
      title="Contracts"
      documents={getProjectDocuments(slug, "contracts")}
      emptyHint="No reviewed contract entries yet. Use Manage project files to check the linked folder; available documents appear above."
      dropboxDocuments={discoverDropboxDocuments(getProjectDropboxDir(project.meta), "contracts")}
      dropboxFileApiBase="/api/dropbox-file"
      folderFiles={discoverDocumentFolderFiles(path.join(contentDir(slug), "contracts"))}
    />
  );
}
