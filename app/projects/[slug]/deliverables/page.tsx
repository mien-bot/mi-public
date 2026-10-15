import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getProject,
  getProjectDeliverablesWithHash,
  getProjectSlugs,
} from "@/lib/content";
import { ProjectDeliverableRegister } from "@/components/ProjectDeliverableRegister";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function DeliverablesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) notFound();
  const project = getProject(slug);
  const { deliverables, hash } = getProjectDeliverablesWithHash(slug);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">← {project.meta.name}</Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">Deliverables</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Dated packages this project issued — presentation decks and plot sets — with who received
          them, which spaces they covered, and what superseded them.
        </p>
      </div>
      <ProjectDeliverableRegister
        slug={slug}
        initialDeliverables={deliverables}
        initialHash={hash}
      />
    </div>
  );
}
