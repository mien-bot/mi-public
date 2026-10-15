import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getProjectSlugs } from "@/lib/content";
import { getProjectMemory, memoryNotesPath } from "@/lib/content/projectWorkspace";
import { readCurrentHash } from "@/lib/content/atomicContentWrite";
import { readProjectKnowledge } from "@/lib/content/projectKnowledge";
import { ProjectKnowledgeBrowser } from "@/components/ProjectKnowledgeBrowser";
import { ProjectKnowledgeActions } from "@/components/ProjectKnowledgeActions";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function KnowledgePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) notFound();
  const project = getProject(slug);
  const knowledge = readProjectKnowledge(getProjectMemory(slug));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← {project.meta.name}
        </Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">Knowledge</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Everything confirmed about this project, from chat, a CLI agent proposal, or a review
          card. Add a note or correction, review incoming knowledge, and publish to the linked Notion page.
          {knowledge && (
            <>
              {" "}
              <span className="text-xs">
                {knowledge.total} note{knowledge.total === 1 ? "" : "s"}
                {knowledge.lastUpdated ? ` · updated ${knowledge.lastUpdated}` : ""} ·{" "}
                <span className="font-mono">{knowledge.relativePath}</span>
              </span>
            </>
          )}
        </p>
      </div>

      <ProjectKnowledgeActions slug={slug} notionLinked={!!project.meta.notion_page_id} initialHash={readCurrentHash(memoryNotesPath(slug))} />
      {knowledge && knowledge.preamble && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Project knowledge overview</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{knowledge.preamble}</p>
        </section>
      )}

      {knowledge && knowledge.total > 0 ? (
        <ProjectKnowledgeBrowser knowledge={knowledge} />
      ) : (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Nothing has been confirmed into this project&apos;s knowledge yet. Confirmed review cards
          and memory notes land here.{" "}
          <Link href={`/review?workspace=${encodeURIComponent(`project/${slug}`)}`} className="text-link underline-offset-2 hover:underline">
            Open the Review Inbox
          </Link>{" "}
          to see what is waiting.
        </p>
      )}
    </div>
  );
}
