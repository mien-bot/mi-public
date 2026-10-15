import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getProjectQuestions, getProjectSlugs } from "@/lib/content";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function QuestionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getProjectSlugs());
  if (!slugs.has(slug)) notFound();

  const project = getProject(slug);
  const questions = getProjectQuestions(slug);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← {project.meta.name}
        </Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">Project Questions</h1>
      </div>
      {questions ? (
        <div
          className="prose prose-sm max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: questions.contentHtml }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No questions recorded yet.</p>
      )}
    </div>
  );
}
