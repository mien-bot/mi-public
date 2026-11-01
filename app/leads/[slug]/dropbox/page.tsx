import Link from "next/link";
import { notFound } from "next/navigation";
import { CreateLeadDropboxFolderButton } from "@/components/CreateLeadDropboxFolderButton";
import { DropboxHealthPanel } from "@/components/DropboxHealthPanel";
import { getLead, getLeadSlugs } from "@/lib/content";

export function generateStaticParams() {
  return getLeadSlugs().map((slug) => ({ slug }));
}

/** Same YY_MMDD_ convention as app/api/projects/next-numbering/route.ts, keyed off when the lead came in. */
function dateStampPrefix(dateReceived: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateReceived)) return "";
  return `${dateReceived.slice(2, 4)}_${dateReceived.slice(5, 7)}${dateReceived.slice(8, 10)}_`;
}

export default async function LeadDropboxPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getLeadSlugs());
  if (!slugs.has(slug)) notFound();

  const { lead } = getLead(slug);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/leads/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← {lead.name}
        </Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">Dropbox Files</h1>
      </div>

      {!lead.dropbox_path && (
        <p className="text-sm text-muted-foreground">
          No Dropbox folder linked. Set it in the <Link href={`/leads/${slug}`} className="text-link underline hover:no-underline">Edit lead</Link> form
          (e.g. <code>1.01 LEADS/{dateStampPrefix(lead.date_received)}{lead.name}</code>, relative
          to the Dropbox root chosen in Settings). Save the exact path, then return here to
          review and create the architectural folders.
        </p>
      )}
      {lead.dropbox_path && <DropboxHealthPanel kind="leads" slug={slug} />}
      {lead.dropbox_path && <section className="rounded-lg border border-border p-4"><h2 className="mb-3 font-medium">Folder setup</h2><CreateLeadDropboxFolderButton slug={slug} dropboxPath={lead.dropbox_path} /></section>}
    </div>
  );
}
