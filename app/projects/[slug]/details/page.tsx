import Link from "next/link";
import { notFound } from "next/navigation";
import { discoverDropboxContractCandidates, getProject, getProjectDetailsWithHash, getProjectSlugs, resolveProjectIdentity } from "@/lib/content";
import { getNotionProjectMapEntry } from "@/lib/notion/projectMap";
import { ProjectDetailsEditor } from "@/components/ProjectDetailsEditor";
import { DeleteWorkspaceButton } from "@/components/DeleteWorkspaceButton";

export function generateStaticParams() { return getProjectSlugs().map((slug) => ({ slug })); }

export default async function DetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) notFound();
  const project = getProject(slug);
  const notion = getNotionProjectMapEntry(project.meta.notion_page_id);
  const { details: stored, hash } = getProjectDetailsWithHash(slug);
  const identity = resolveProjectIdentity(project.meta, stored);
  const initial = {
    ...stored,
    client_name: identity.client,
    address: identity.address,
    project_type: stored.project_type || project.meta.building_type || "",
    team: identity.team,
  };
  const notionUrl = notion?.notion_url ?? (project.meta.notion_page_id
    ? `https://www.notion.so/${project.meta.notion_page_id.replaceAll("-", "")}`
    : null);
  return <div className="flex flex-col gap-6"><div><Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">← {project.meta.name}</Link><h1 className="mt-1 font-display text-2xl font-light tracking-wide">Project Details</h1></div><ProjectDetailsEditor slug={slug} initial={initial} initialHash={hash} dropboxPath={project.meta.dropbox_path} notionUrl={notionUrl} contractCandidates={discoverDropboxContractCandidates(project.meta)} feeCandidate={null} /><DeleteWorkspaceButton endpoint={`/api/projects/${encodeURIComponent(slug)}`} name={project.meta.name} label="Delete project from Mi" note={`Removes Mi's own record folder for this project. ${project.meta.content_location === "dropbox" ? "The Dropbox content folder is left exactly where it is — the drawings and submittals are not Mi's to delete." : "Local project records under projects/ are removed."}${project.meta.notion_page_id ? " Any linked Notion page is also left in place." : ""}`} redirectTo="/projects" /></div>;
}
