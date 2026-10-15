import path from "node:path";
import { notFound } from "next/navigation";
import { discoverDocumentFolderFiles, discoverDropboxDocuments, getLead, getLeadDocuments, getLeadDropboxDir, getLeadSlugs, leadDir } from "@/lib/content";
import { ProjectDocuments } from "@/components/ProjectDocuments";

export function generateStaticParams() {
  return getLeadSlugs().map((slug) => ({ slug }));
}

export default async function LeadOwnerSuppliedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getLeadSlugs());
  if (!slugs.has(slug)) notFound();
  const lead = getLead(slug).lead;

  return (
    <ProjectDocuments
      slug={slug}
      folder="owner-supplied"
      title="Owner-supplied information"
      documents={getLeadDocuments(slug, "owner-supplied")}
      emptyHint={`Nothing indexed yet — drop files (existing plans, surveys, deeds, prior permits) into leads/${slug}/owner-supplied/ then index them.`}
      backHref={`/leads/${slug}`}
      fileApiBase="/api/lead-file"
      dropboxDocuments={discoverDropboxDocuments(getLeadDropboxDir(lead), "owner-supplied")}
      dropboxFileApiBase="/api/lead-dropbox-file"
      folderFiles={discoverDocumentFolderFiles(path.join(leadDir(slug), "owner-supplied"))}
    />
  );
}
