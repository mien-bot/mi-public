import Link from "next/link";
import { ReviewAutomationSetting } from "@/components/ReviewAutomationSetting";
import { PendingReviewCards } from "@/components/PendingReviewCards";
import type { WorkspaceReviewSummary } from "@/lib/content/reviewInboxService";

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * A record's own view of what is waiting on it.
 *
 * Renders even at zero, unlike the older approvals banner, because this panel answers a
 * question people ask ("is anything waiting on this lead?") rather than only raising an
 * alarm — and an area that disappears when empty teaches you not to look for it.
 */
export function PendingReviewPanel({ summary }: { summary: WorkspaceReviewSummary }) {
  const { workspace, counts, pending, meetingPendingCount } = summary;
  const workspaceFilter = `${workspace.kind}/${workspace.slug}`;
  const reviewHref = `/review?workspace=${encodeURIComponent(workspaceFilter)}`;

  return (
    <section
      id="pending-review"
      aria-labelledby="pending-review-heading"
      className={`scroll-mt-6 rounded-lg border p-4 ${
        counts.pending > 0 || counts.failed > 0 ? "border-accent bg-accent/5" : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pending-review-heading" className="font-medium">
            Pending Review
            {counts.pending > 0 && (
              <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-background">
                {counts.pending} pending
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {counts.pending === 0 && counts.failed === 0
              ? "Nothing from a terminal session is waiting for confirmation."
              : "Captured automatically from this workspace's Mi/inbox folder. Nothing here has changed any record."}
          </p>
          {meetingPendingCount > 0 && (
            <p className="mt-1 text-sm font-medium">
              {meetingPendingCount} meeting-note {plural(meetingPendingCount, "entry is", "entries are")} waiting for confirmation.
            </p>
          )}
          {counts.failed > 0 && (
            <p className="mt-1 text-sm text-destructive">
              {counts.failed} {plural(counts.failed, "entry", "entries")} could not be imported and {plural(counts.failed, "needs", "need")} attention.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={reviewHref}
            className="tactile-control rounded-md border border-border px-3 py-2 text-sm hover:border-accent"
          >
            Review all
          </Link>
          <Link
            href="/review"
            className="tactile-control rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:border-accent hover:text-foreground"
          >
            Open Review Inbox
          </Link>
        </div>
      </div>

      {pending.length > 0 && <PendingReviewCards views={pending} />}

      {counts.pending > pending.length && (
        <p className="mt-3 text-sm">
          <Link href={reviewHref} className="text-link underline-offset-2 hover:underline">
            {counts.pending - pending.length} more pending {plural(counts.pending - pending.length, "card", "cards")} →
          </Link>
        </p>
      )}

      {(counts.applied > 0 || counts.dismissed > 0 || counts.superseded > 0) && (
        <p className="mt-3 text-xs text-muted-foreground">
          Already reviewed: {counts.applied} applied · {counts.dismissed} dismissed · {counts.superseded} superseded.
        </p>
      )}

      <ReviewAutomationSetting kind={workspace.kind} slug={workspace.slug} automation={summary.automation} />
    </section>
  );
}
