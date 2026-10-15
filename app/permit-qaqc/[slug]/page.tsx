import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentWorkspaceManager } from "@/components/AgentWorkspaceManager";
import { PendingReviewPanel } from "@/components/PendingReviewPanel";
import { WorkspaceAnalysisPanel } from "@/components/WorkspaceAnalysis";
import { readWorkspaceReviewSummary } from "@/lib/content/reviewInboxService";
import { analysisNudge, readStoredAnalysis } from "@/lib/content/workspaceAnalysisStore";
import { DeletePermitQaqcButton } from "@/components/DeletePermitQaqcButton";
import { PermitQaqcForm } from "@/components/PermitQaqcForm";
import { StatusBadge } from "@/components/StatusBadge";
import { getPermitQaqcDropboxDir, getPermitQaqcEngagementWithHash, getPermitQaqcSlugs, listDropboxTree } from "@/lib/content";
import { listPermitQaqcCorrespondence } from "@/lib/permitQaqcEmail/listCorrespondence";

export function generateStaticParams() {
  return getPermitQaqcSlugs().map((slug) => ({ slug }));
}

export default async function PermitQaqcDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getPermitQaqcSlugs().includes(slug)) notFound();
  const { engagement, hash } = getPermitQaqcEngagementWithHash(slug);
  const dropboxDir = getPermitQaqcDropboxDir(engagement);
  const reviewSummary = readWorkspaceReviewSummary("permit-qaqc", slug);
  const correspondence = dropboxDir
    ? await listPermitQaqcCorrespondence(dropboxDir, listDropboxTree(dropboxDir))
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/permit-qaqc" className="text-sm text-muted-foreground hover:underline">← Permit QAQC</Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="font-display text-2xl font-light tracking-wide">{engagement.name}</h1>
          <StatusBadge status={engagement.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Submitted by {engagement.submitting_firm}
          {engagement.engagement_number && ` · No. ${engagement.engagement_number}`}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <Link href={`/permit-qaqc/${slug}/terminal`} className="text-link underline hover:no-underline">
            Terminal
          </Link>
          <Link href={`/permit-qaqc/${slug}/dropbox`} className="text-link underline hover:no-underline">
            Dropbox files
          </Link>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Edit engagement</h2>
        <PermitQaqcForm mode="edit" slug={slug} initialEngagement={engagement} initialHash={hash} />
      </section>

      <PendingReviewPanel summary={reviewSummary} />

      <WorkspaceAnalysisPanel
        kind="permit-qaqc"
        slug={slug}
        initialAnalysis={readStoredAnalysis("permit-qaqc", slug)}
        nudge={analysisNudge("permit-qaqc", slug)}
      />

      <AgentWorkspaceManager slug={slug} kind="permit-qaqc" />

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Correspondence</h2>
        <p className="text-xs text-muted-foreground">
          Read directly from the linked Dropbox folder&apos;s .eml files — nothing here is copied
          or stored by Mi.
        </p>
        {!dropboxDir && (
          <p className="text-sm text-muted-foreground">
            Link a Dropbox folder above to read this engagement&apos;s emails.
          </p>
        )}
        {dropboxDir && correspondence && correspondence.emails.length === 0 && correspondence.errors.length === 0 && (
          <p className="text-sm text-muted-foreground">No .eml files found in the linked folder.</p>
        )}
        {correspondence && correspondence.emails.length > 0 && (
          <ul className="flex flex-col gap-2">
            {correspondence.emails.map((email) => (
              <li key={email.relativePath} className="rounded-md border border-border p-3 text-sm">
                <div className="font-medium">{email.subject ?? "(no subject)"}</div>
                <div className="text-xs text-muted-foreground">
                  {email.from ?? "(unknown sender)"}
                  {email.to && ` → ${email.to}`}
                  {email.date && ` · ${new Date(email.date).toLocaleString()}`}
                </div>
                {email.attachmentFilenames.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Attachments: {email.attachmentFilenames.join(", ")}
                  </div>
                )}
                {email.textBody && (
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                    {email.textBody.length > 600 ? `${email.textBody.slice(0, 600)}…` : email.textBody}
                  </p>
                )}
                <div className="mt-1 text-xs text-muted-foreground">{email.relativePath}</div>
              </li>
            ))}
          </ul>
        )}
        {correspondence && correspondence.errors.length > 0 && (
          <div className="rounded-md border border-status-warning-foreground/40 bg-status-warning/30 p-3 text-xs text-muted-foreground">
            {correspondence.errors.length} email file{correspondence.errors.length === 1 ? "" : "s"} could not
            be parsed:
            <ul className="mt-1 list-disc pl-4">
              {correspondence.errors.map((entry) => (
                <li key={entry.relativePath}>{entry.relativePath} — {entry.error}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-red-500/30 p-4">
        <h2 className="font-medium">Remove engagement</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Deletion requires confirmation and keeps a recoverable local backup. The real Dropbox
          folder and its files are never touched.
        </p>
        <div className="mt-3"><DeletePermitQaqcButton slug={slug} name={engagement.name} /></div>
      </section>
    </div>
  );
}
