import Link from "next/link";
import { connection } from "next/server";
import { CodeLibraryBrowser } from "@/components/CodeLibraryBrowser";
import { getAllCodeSections, getCodeBookEditions } from "@/lib/content";
import { getLocalCodeLibraryIndex } from "@/lib/content/localCodeLibrary";

export const runtime = "nodejs";

export default async function CodesPage() {
  await connection();

  const bookEditions = getCodeBookEditions();
  const allSections = getAllCodeSections();
  const localLibrary = getLocalCodeLibraryIndex();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-light tracking-wide">Codes Library</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Browse the firm&apos;s reviewed summaries separately from private source documents stored on
          this machine. Always confirm requirements against the current official source.
        </p>
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="curated-code-summaries">
        <div>
          <h2 id="curated-code-summaries" className="font-medium">Firm-authored summaries</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Reviewed summaries and citations from the tracked <code>codes/</code> collection. These
            entries do not reproduce source code text.
          </p>
        </div>

        {bookEditions.map(({ book, edition }) => {
          const sections = allSections.filter((s) => s.book === book && s.edition === edition);
          return (
            <div key={`${book}/${edition}`}>
              <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {book} · {edition}
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {sections.map((s) => (
                  <li key={s.slug}>
                    <Link
                      href={`/codes/${book}/${edition}/${s.slug}`}
                      className="flex items-center justify-between rounded-md border border-border p-3 text-sm transition-colors hover:border-accent"
                    >
                      <span>
                        <span className="font-medium">{s.doc.frontmatter.section}</span> —{" "}
                        {s.doc.frontmatter.title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {bookEditions.length === 0 && (
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            No firm-authored summaries are available yet. Add reviewed Markdown entries under{" "}
            <code>codes/</code>.
          </p>
        )}
      </section>

      <section
        className="flex flex-col gap-4 border-t border-border pt-8"
        aria-labelledby="local-code-sources"
      >
        <div>
          <h2 id="local-code-sources" className="font-medium">Local source documents</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Private reference files are indexed by filename and folder only. Their contents remain
            outside Git and are not added to the firm-authored summaries automatically.
          </p>
        </div>

        {localLibrary.available ? (
          <>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-muted px-2.5 py-1">
                {localLibrary.documentCount} document{localLibrary.documentCount === 1 ? "" : "s"}
              </span>
              <span className="rounded-full bg-muted px-2.5 py-1">
                {localLibrary.source === "environment"
                  ? "Configured local source"
                  : "Discovered local copy"}
              </span>
              {localLibrary.truncated && (
                <span className="rounded-full bg-muted px-2.5 py-1">Index limit reached</span>
              )}
            </div>
            <CodeLibraryBrowser nodes={localLibrary.nodes} />
          </>
        ) : (
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Private library unavailable on this machine</p>
            <p className="mt-1">
              {localLibrary.message} Set <code>MI_CODE_LIBRARY_ROOT</code> in <code>.env.local</code> to
              a local copy of the private source library. The firm-authored summaries above remain
              available without it.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
