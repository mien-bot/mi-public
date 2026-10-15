import Link from "next/link";
import { notFound } from "next/navigation";
import { discoverDropboxContractCandidates, getProject, getProjectDocuments, getProjectSlugs } from "@/lib/content";
import { FilesContractsWorkspace } from "@/components/FilesContractsWorkspace";
import { PdfBrandExport } from "@/components/PdfBrandExport";
import { connection } from "next/server";
import { ProjectDiscoveryPanel } from "@/components/ProjectDiscoveryPanel";

export function generateStaticParams() { return getProjectSlugs().map((slug) => ({ slug })); }

export default async function FilesPage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) notFound();
  const project = getProject(slug);
  const indexed = getProjectDocuments(slug, "contracts").map((document) => ({ file: document.file, title: document.title }));
  return <div className="flex flex-col gap-6">
    <div><Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">← {project.meta.name}</Link><h1 className="mt-1 font-display text-2xl font-light tracking-wide">Project files</h1></div>
    <ProjectDiscoveryPanel slug={slug} mode="files" />
    <section className="space-y-3 rounded-lg border border-border bg-card p-4"><h2 className="font-medium">PDF branding</h2><p className="text-sm text-muted-foreground">Add the Mi logo, then review where to save the branded copy in this project.</p><PdfBrandExport projectSlug={slug} /></section>
    <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer font-medium">Contracts &amp; document management</summary><div className="mt-4"><FilesContractsWorkspace slug={slug} dropboxPath={project.meta.dropbox_path} candidates={discoverDropboxContractCandidates(project.meta)} indexedContracts={indexed} /></div></details>
  </div>;
}
