import Link from "next/link";
import { LibraryWorkspace } from "@/components/LibraryWorkspace";
import { getAllLibraryCollections } from "@/lib/content";
import { RECOMMENDED_LIBRARY_FOLDERS } from "@/lib/content/dropboxLibraryPlan";

export default function LibraryPage() {
  const collections = getAllLibraryCollections();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-wide">Library</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Codes Library contains curated, firm-authored code summaries. Mi Library keeps lightweight
          metadata for indexed local files. Dropbox source files stay external and are never copied
          into Mi by these tools.
        </p>
      </div>
      <LibraryWorkspace recommendedFolders={[...RECOMMENDED_LIBRARY_FOLDERS]} />
      <section className="grid gap-3">
        <h2 className="font-medium">Local Mi collections</h2>
        {collections.map((collection) => (
          <Link
            key={collection.slug}
            href={`/library/${collection.slug}`}
            className="card-hover flex items-center justify-between rounded-lg border border-border p-4 hover:border-accent"
          >
            <span>
              <span className="font-medium">{collection.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{collection.slug}</span>
            </span>
            <span className="text-sm text-muted-foreground">
              {collection.documents.length} document{collection.documents.length === 1 ? "" : "s"}
            </span>
          </Link>
        ))}
        {collections.length === 0 && (
          <p className="text-sm text-muted-foreground">No local metadata collections yet.</p>
        )}
      </section>
    </div>
  );
}
