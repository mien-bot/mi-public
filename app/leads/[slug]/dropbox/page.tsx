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
          above (e.g. <code>1.01 LEADS/{dateStampPrefix(lead.date_received)}{lead.name}</code>, relative
          to your machine&apos;s <code>DROPBOX_ROOT</code> in <code>.env.local</code>) to browse its
          real files here.
        </p>
      )}
      {lead.dropbox_path && <DropboxHealthPanel kind="leads" slug={slug} />}
      {lead.dropbox_path && <details><summary className="cursor-pointer text-sm text-muted-foreground">Folder setup</summary><CreateLeadDropboxFolderButton slug={slug} dropboxPath={lead.dropbox_path} /></details>}
    </div>
  );
}
