import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllCodeSections, getCodeSection, getCodeSectionCitations } from "@/lib/content";

export function generateStaticParams() {
  return getAllCodeSections().map(({ book, edition, slug }) => ({ book, edition, section: slug }));
}

export default async function CodeSectionPage({
  params,
}: {
  params: Promise<{ book: string; edition: string; section: string }>;
}) {
  const { book, edition, section } = await params;
  const codeSection = getCodeSection(book, edition, section);
  if (!codeSection) notFound();

  const { doc } = codeSection;
  const citations = getCodeSectionCitations(doc.frontmatter.id);
  const hasCitations =
    citations.checklistItems.length > 0 || citations.reviews.length > 0 || citations.markups.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/codes" className="text-sm text-muted-foreground hover:underline">
          ← Codes Library
        </Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">
          {doc.frontmatter.section} — {doc.frontmatter.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{doc.frontmatter.citation}</p>
      </div>

      <div
        className="prose prose-sm max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: doc.contentHtml }}
      />

      <a
        href={doc.frontmatter.official_source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-link hover:underline"
      >
        Official source ↗
      </a>

      {doc.frontmatter.applicability_tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {doc.frontmatter.applicability_tags.map((tag) => (
            <span key={tag} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}

      {doc.frontmatter.related_sections.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Related sections: {doc.frontmatter.related_sections.join(", ")}
        </div>
      )}

      {hasCitations && (
        <section>
          <h2 className="font-medium">Cited by</h2>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {citations.checklistItems.map((c) => (
              <li key={`checklist-${c.projectSlug}-${c.itemId}`}>
                <Link href={`/projects/${c.projectSlug}/checklist`} className="hover:underline">
                  {c.projectName}
                </Link>{" "}
                checklist — {c.itemDescription}
              </li>
            ))}
            {citations.reviews.map((c) => (
              <li key={`review-${c.projectSlug}-${c.reviewSlug}`}>
                <Link href={`/projects/${c.projectSlug}`} className="hover:underline">
                  {c.projectName}
                </Link>{" "}
                review — {c.reviewDate}
              </li>
            ))}
            {citations.markups.map((c) => (
              <li key={`markup-${c.projectSlug}-${c.sheet}-${c.revision}`}>
                <Link href={`/projects/${c.projectSlug}`} className="hover:underline">
                  {c.projectName}
                </Link>{" "}
                markup — {c.sheet} rev.{c.revision}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!hasCitations && (
        <p className="text-sm text-muted-foreground">Not yet cited by any project checklist, review, or markup.</p>
      )}
    </div>
  );
}
