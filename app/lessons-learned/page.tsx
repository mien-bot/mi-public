import { getAllLessonsLearned } from "@/lib/content";
import { LessonsBrowser } from "@/components/LessonsBrowser";

export default function LessonsLearnedPage() {
  const lessons = getAllLessonsLearned();
  const entries = lessons.map((l) => ({
    projectSlug: l.projectSlug,
    projectName: l.projectName,
    contentHtml: l.doc.contentHtml,
    searchText: l.doc.contentMarkdown,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-wide">Lessons Learned</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Searchable across every project — a mistake caught once here shouldn&apos;t repeat on the
          next job.
        </p>
      </div>
      <LessonsBrowser entries={entries} />
    </div>
  );
}
