import Link from "next/link";
import { notFound } from "next/navigation";
import { getChecklistCompletion, getCodeSectionById, getProject, getProjectSlugs, getQaqcChecklist } from "@/lib/content";
import { StatusBadge } from "@/components/StatusBadge";
import { getProjectDropboxDir, listDropboxTree } from "@/lib/content";
import type { DropboxNode } from "@/lib/content";

function flattenDrawingCandidates(nodes: DropboxNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(!node.isDirectory && /\.(?:pdf|dwg|dxf|rvt|ifc)$/i.test(node.name) ? [node.relativePath] : []),
    ...(node.children ? flattenDrawingCandidates(node.children) : []),
  ]);
}

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function QaqcPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getProjectSlugs());
  if (!slugs.has(slug)) notFound();

  const project = getProject(slug);
  const qaqc = getQaqcChecklist(slug);
  const completion = getChecklistCompletion(qaqc);
  const dropboxDir = getProjectDropboxDir(project.meta);
  const dropboxTree = dropboxDir ? listDropboxTree(dropboxDir) : [];
  const drawingCandidates = flattenDrawingCandidates(dropboxTree);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← {project.meta.name}
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="font-display text-2xl font-light tracking-wide">QA/QC</h1>
          {completion.total > 0 && (
            <span className="text-sm text-muted-foreground">
              {completion.percentComplete}% complete ({completion.complete}/{completion.total})
            </span>
          )}
        </div>
      </div>

      <section className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Drawing review workspace</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Metadata-only inventory from the confirmed Dropbox project folder. Open drawings for visual review before creating findings.
            </p>
          </div>
          <a
            href={`/api/projects/${slug}/qaqc-comments`}
            className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent"
          >
            Export comment register CSV
          </a>
        </div>
        <p className="mt-3 text-sm">
          {dropboxDir
            ? `${drawingCandidates.length} drawing/model candidate(s) visible in the bounded Dropbox inventory.`
            : "No confirmed Dropbox folder is linked."}
        </p>
        {drawingCandidates.length > 0 && (
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
            {drawingCandidates.slice(0, 100).map((file) => <li key={file}>{file}</li>)}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          The CSV is a review comment register for Bluebeam coordination; Mi does not claim to insert markups into Revu. Export Revu&apos;s Markups List CSV separately to bring completed markup status back into Mi.
        </p>
      </section>

      <ul className="flex flex-col gap-3">
        {(qaqc?.items ?? []).map((item) => (
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
        {(!qaqc || qaqc.items.length === 0) && (
          <p className="text-sm text-muted-foreground">No QA/QC items yet.</p>
        )}
      </ul>
    </div>
  );
}
