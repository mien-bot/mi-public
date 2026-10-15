import path from "node:path";
import { notFound } from "next/navigation";
import { discoverDocumentFolderFiles, discoverDropboxDocuments, getLead, getLeadDocuments, getLeadDropboxDir, getLeadSlugs, leadDir } from "@/lib/content";
import { ProjectDocuments } from "@/components/ProjectDocuments";

export function generateStaticParams() {
  return getLeadSlugs().map((slug) => ({ slug }));
}

export default async function LeadContractsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getLeadSlugs());
  if (!slugs.has(slug)) notFound();
  const lead = getLead(slug).lead;

  return (
    <ProjectDocuments
      slug={slug}
      folder="contracts"
      title="Contract drafts"
      documents={getLeadDocuments(slug, "contracts")}
      emptyHint={`No contract documents indexed yet — drop files into leads/${slug}/contracts/ then index them.`}
      backHref={`/leads/${slug}`}
      fileApiBase="/api/lead-file"
      dropboxDocuments={discoverDropboxDocuments(getLeadDropboxDir(lead), "contracts")}
      dropboxFileApiBase="/api/lead-dropbox-file"
      folderFiles={discoverDocumentFolderFiles(path.join(leadDir(slug), "contracts"))}
    />
  );
}
