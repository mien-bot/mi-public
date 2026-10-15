import Link from "next/link";
import { notFound } from "next/navigation";
import { LibraryDocumentEditor } from "@/components/LibraryDocumentEditor";
import { DeleteWorkspaceButton } from "@/components/DeleteWorkspaceButton";
import {
  getAllLibraryCollections,
  getLibraryCollectionName,
  getLibraryDocuments,
} from "@/lib/content";

export function generateStaticParams() {
  return getAllLibraryCollections().map((collection) => ({ collection: collection.slug }));
}

export default async function LibraryCollectionPage({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;
  const slugs = new Set(getAllLibraryCollections().map((item) => item.slug));
  if (!slugs.has(collection)) notFound();
  const documents = getLibraryDocuments(collection);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/library" className="text-sm text-muted-foreground hover:underline">← Library</Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">
          {getLibraryCollectionName(collection)}
        </h1>
        <p className="text-sm text-muted-foreground">{collection}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {documents.map((document) => (
          <li key={document.file} className="rounded-md border border-border p-4 text-sm">
            <a
              href={`/api/library-file/${collection}/${encodeURIComponent(document.file)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:underline"
            >
              {document.title || document.file}
            </a>
            <div className="text-muted-foreground">
              {document.file} · added {document.added_date}
              {document.tags.length > 0 && ` · ${document.tags.join(", ")}`}
            </div>
            {document.source && <div className="mt-1 text-muted-foreground">Source: {document.source}</div>}
            {document.notes && <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{document.notes}</div>}
            <LibraryDocumentEditor collection={collection} document={document} />
          </li>
        ))}
        {documents.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No source files are indexed. Mi does not upload or copy binaries; add reviewed local files
            outside this UI, then run <code>npm run index-library -- {collection}</code>.
          </p>
        )}
      </ul>
      <DeleteWorkspaceButton
        endpoint={`/api/library/collections/${encodeURIComponent(collection)}`}
        name={getLibraryCollectionName(collection)}
        label="Delete collection"
        note={`Removes this collection's folder, its index, and all ${documents.length} indexed document(s).`}
        redirectTo="/library"
      />
    </div>
  );
}
