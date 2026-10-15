import Link from "next/link";
import { notFound } from "next/navigation";
import { getChecklist, getChecklistCompletion, getCodeSectionById, getProject, getProjectSlugs } from "@/lib/content";
import { StatusBadge } from "@/components/StatusBadge";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function ChecklistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getProjectSlugs());
  if (!slugs.has(slug)) notFound();

  const project = getProject(slug);
  const checklist = getChecklist(slug);
  const completion = getChecklistCompletion(checklist);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← {project.meta.name}
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="font-display text-2xl font-light tracking-wide">Code Compliance Checklist</h1>
          {completion.total > 0 && (
            <span className="text-sm text-muted-foreground">
              {completion.percentComplete}% complete ({completion.complete}/{completion.total})
            </span>
          )}
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {(checklist?.items ?? []).map((item) => (
          <li key={item.id} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{item.description}</div>
              <StatusBadge status={item.status} />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Discipline: {item.discipline}</div>
            {item.code_refs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {item.code_refs.map((ref) => {
                  const section = getCodeSectionById(ref);
                  if (!section) {
                    return (
                      <span key={ref} className="text-xs text-red-600 dark:text-red-400">
                        {ref} (unresolved)
                      </span>
                    );
                  }
                  return (
                    <Link
                      key={ref}
                      href={`/codes/${section.book}/${section.edition}/${section.slug}`}
                      className="rounded-full border border-border px-2.5 py-0.5 text-xs transition-colors hover:border-accent"
                    >
                      {section.doc.frontmatter.citation}
                    </Link>
                  );
                })}
              </div>
            )}
          </li>
        ))}
        {(!checklist || checklist.items.length === 0) && (
          <p className="text-sm text-muted-foreground">No checklist items yet.</p>
        )}
      </ul>
    </div>
  );
}
