import Link from "next/link";
import { notFound } from "next/navigation";
import { DropboxHealthPanel } from "@/components/DropboxHealthPanel";
import { getPermitQaqcEngagement, getPermitQaqcSlugs } from "@/lib/content";

export function generateStaticParams() {
  return getPermitQaqcSlugs().map((slug) => ({ slug }));
}

export default async function PermitQaqcDropboxPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getPermitQaqcSlugs());
  if (!slugs.has(slug)) notFound();

  const { engagement } = getPermitQaqcEngagement(slug);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/permit-qaqc/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← {engagement.name}
        </Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">Dropbox Files</h1>
      </div>

      {!engagement.dropbox_path && (
        <p className="text-sm text-muted-foreground">
          No Dropbox folder linked yet. Set it in the{" "}
          <Link href={`/permit-qaqc/${slug}`} className="text-link underline hover:no-underline">Edit engagement</Link>{" "}
          form above — this folder already exists in Dropbox (it&apos;s where the other firm&apos;s
          submission was received), Mi never creates it.
        </p>
      )}
      {engagement.dropbox_path && <DropboxHealthPanel kind="permit-qaqc" slug={slug} />}
    </div>
  );
}
