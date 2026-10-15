import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getProjectSlugs } from "@/lib/content/projects";
import { ProjectDiscoveryPanel } from "@/components/ProjectDiscoveryPanel";
export default async function ProjectActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) notFound();
  return <div className="space-y-4"><h1 className="font-display text-2xl">Project activity</h1><ProjectDiscoveryPanel slug={slug} mode="activity" /></div>;
}
