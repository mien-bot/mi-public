import { notFound } from "next/navigation";
import {
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
  const { deliverables, hash } = getProjectDeliverablesWithHash(slug);

  return (
    <div className="flex flex-col gap-6">
      <div>
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
