import Link from "next/link";
import type { LibraryDocument } from "@/lib/schema";
import type { ProjectDocumentFolder } from "@/lib/content";
import type { DropboxDocumentCandidate } from "@/lib/content/dropboxDocuments";
import { DropboxDocumentsRefresh } from "@/components/DropboxDocumentsRefresh";

function fileHref(base: string, slug: string, relativePath: string): string {
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encodeURIComponent(slug)}/${encodedPath}`;
}

export function ProjectDocuments({
  slug,
  folder,
  title,
  documents,
  emptyHint,
  backHref,
  fileApiBase = "/api/project-file",
  dropboxDocuments = [],
  dropboxFileApiBase,
  folderFiles = [],
}: {
  slug: string;
  folder: ProjectDocumentFolder | string;
  title: string;
  documents: LibraryDocument[];
  emptyHint: string;
  backHref?: string;
  /** Which file-serving route to build download links from — leads use "/api/lead-file" instead of the project default. */
  fileApiBase?: string;
  /** Live, metadata-only results from the exact confirmed Dropbox folder. */
  dropboxDocuments?: DropboxDocumentCandidate[];
  dropboxFileApiBase?: "/api/dropbox-file" | "/api/lead-dropbox-file";
  folderFiles?: DropboxDocumentCandidate[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={backHref ?? `/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">
            ← Back
          </Link>
          <h1 className="mt-1 font-display text-2xl font-light tracking-wide">{title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!backHref && <Link href={`/projects/${slug}/files`} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent">Manage project files</Link>}
          <DropboxDocumentsRefresh />
        </div>
      </div>
      {dropboxFileApiBase && (
        <section className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">Dropbox files</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Live filename scan of the confirmed folder. Mi does not read or modify file contents during refresh.
              </p>
            </div>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {dropboxDocuments.map((document) => (
              <li key={document.relativePath} className="rounded-md border border-border p-3 text-sm">
                <a
                  href={fileHref(dropboxFileApiBase, slug, document.relativePath)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                >
                  {document.name}
                </a>
                <code className="mt-1 block break-all text-[11px] text-muted-foreground">{document.relativePath}</code>
              </li>
            ))}
            {dropboxDocuments.length === 0 && (
              <li className="text-sm text-muted-foreground">
                No matching Dropbox files are available. Check this workspace’s folder link, then refresh.
              </li>
            )}
          </ul>
        </section>
      )}
      <section className="rounded-lg border border-border p-4">
        <h2 className="font-medium">Files in Mi folder</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Files appear here immediately, even before optional titles, tags, and notes are added to the reviewed index.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {folderFiles.map((document) => (
            <li key={document.relativePath} className="rounded-md border border-border p-3 text-sm">
              <a
                href={fileHref(fileApiBase, slug, `${folder}/${document.relativePath}`)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline"
              >
                {document.name}
              </a>
              <code className="mt-1 block break-all text-[11px] text-muted-foreground">{document.relativePath}</code>
            </li>
          ))}
          {folderFiles.length === 0 && <li className="text-sm text-muted-foreground">No files found in this Mi folder.</li>}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 font-medium">Reviewed Mi index</h2>
      <ul className="flex flex-col gap-2">
        {documents.map((doc) => {
          const archived = doc.tags.includes("archived");
          return (
            <li
              key={doc.file}
              className={`flex items-center justify-between rounded-md border border-border p-3 text-sm ${archived ? "opacity-60" : ""}`}
            >
              <div>
                <a
                  href={`${fileApiBase}/${slug}/${folder}/${encodeURIComponent(doc.file)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                >
                  {doc.title}
                </a>
                {archived && <span className="ml-2 text-xs text-muted-foreground">(archived)</span>}
                <div className="text-muted-foreground">
                  added {doc.added_date}
                  {doc.tags.filter((t) => t !== "archived").length > 0 &&
                    ` · ${doc.tags.filter((t) => t !== "archived").join(", ")}`}
                </div>
                {doc.notes && <div className="mt-1 text-muted-foreground">{doc.notes}</div>}
              </div>
            </li>
          );
        })}
        {documents.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {folderFiles.length > 0
              ? "No reviewed metadata entries yet. The files above remain available; indexing only adds curated titles, tags, and notes."
              : emptyHint}
          </p>
        )}
      </ul>
      </section>
    </div>
  );
}
