import { getMepFaqDocs } from "@/lib/content";

export default function MepFaqPage() {
  const docs = getMepFaqDocs();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-2xl font-light tracking-wide">MEP FAQ</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Cross-project mechanical, electrical, and plumbing knowledge. Project-specific MEP questions
        live on each project&apos;s page instead.
      </p>
      {docs.length > 1 && (
        <nav className="flex gap-4 text-sm">
          {docs.map((doc) => (
            <a
              key={doc.slug}
              href={`#${doc.frontmatter.discipline}`}
              className="capitalize text-muted-foreground hover:underline"
            >
              {doc.frontmatter.discipline}
            </a>
          ))}
        </nav>
      )}
      {docs.map((doc) => (
        <section key={doc.slug} id={doc.frontmatter.discipline}>
          <h2 className="font-medium capitalize uppercase tracking-wide text-muted-foreground">
            {doc.frontmatter.discipline}
          </h2>
          <div
            className="prose prose-sm mt-2 max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: doc.contentHtml }}
          />
        </section>
      ))}
      {docs.length === 0 && (
        <p className="text-sm text-muted-foreground">No MEP FAQ content yet — add files under `reference/mep-faq/`.</p>
      )}
    </div>
  );
}
