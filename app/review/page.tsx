import type { Metadata } from "next";
import Link from "next/link";
import { ReviewInboxBrowser } from "@/components/ReviewInboxBrowser";
import { AllProjectHarnessManager } from "@/components/AllProjectHarnessManager";
import { REVIEW_AUTOMATION_LABELS } from "@/lib/reviewAutomation";
import { readGlobalReviewInbox } from "@/lib/content/reviewInboxService";

export const metadata: Metadata = { title: "Review Inbox" };

// Reads each workspace's Mi/inbox folder on every visit; a build-time snapshot would show
// yesterday's mailbox.
export const dynamic = "force-dynamic";

/**
 * The global mailbox.
 *
 * Rendering imports entries but applies nothing — automation runs from the polled count
 * route, so opening or refreshing this page can never become a write to a lead or project.
 */
export default async function ReviewInboxPage({ searchParams }: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const { workspace } = await searchParams;
  const inbox = readGlobalReviewInbox();
  const scoped = inbox.perWorkspace.find((entry) => `${entry.workspace.kind}/${entry.workspace.slug}` === workspace);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-light tracking-wide">Review Inbox</h1>
          {inbox.counts.pending > 0 && (
            <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-background">
              {inbox.counts.pending} pending
            </span>
          )}
          {inbox.counts.failed > 0 && (
            <span className="rounded-full bg-destructive px-2.5 py-1 text-xs font-medium text-background">
              {inbox.counts.failed} failed
            </span>
          )}
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Select items from one or several projects, review the changes grouped by workspace,
          then accept them together. Project knowledge is the default destination; meetings and
          other records remain available. Publishing to Notion is a separate action from Knowledge.
        </p>
        {scoped && (
          <p className="mt-2 text-sm">
            Showing {scoped.workspace.label} only ·{" "}
            <Link href="/review" className="text-link underline-offset-2 hover:underline">show every workspace</Link>
            {" · "}
            <Link href={scoped.workspace.href} className="text-link underline-offset-2 hover:underline">
              open the workspace
            </Link>
          </p>
        )}
      </div>

      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">Dropbox &amp; agent workspaces · missing inbox items?</summary>
        <p className="my-3 max-w-3xl text-sm text-muted-foreground">
          Link the exact Dropbox folder on the project’s Files page, then check its agent workspace here.
          Agents write draft data into that folder’s Mi/inbox. Refresh this inbox after Dropbox finishes
          syncing to review new items. Accepting saves each item to its project’s configured record location.
        </p>
        <AllProjectHarnessManager />
      </details>

      {inbox.unavailable.length > 0 && <section role="status" className="rounded-xl border border-destructive/40 p-4 text-sm">
        <h2 className="font-medium">{inbox.unavailable.length} workspace inboxes could not be checked</h2>
        <p className="mt-1 text-muted-foreground">Their counts are not included below. Check Dropbox sync and the linked folder, then refresh.</p>
        <ul className="mt-2 flex flex-wrap gap-3">
          {inbox.unavailable.map(workspace => <li key={`${workspace.kind}/${workspace.slug}`}>
            <Link className="text-link underline" href={`${workspace.href}${workspace.kind === "project" ? "/files" : ""}`}>{workspace.label}</Link>
          </li>)}
        </ul>
      </section>}

      {inbox.perWorkspace.length > 0 && (
        <details className="rounded-lg border border-border bg-card p-4" aria-label="Pending by workspace">
          <summary className="cursor-pointer text-sm font-medium">Workspace activity · {inbox.perWorkspace.length} workspaces</summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {inbox.perWorkspace.map((entry) => (
              <li key={`${entry.workspace.kind}/${entry.workspace.slug}`}>
                <Link
                  href={`/review?workspace=${encodeURIComponent(`${entry.workspace.kind}/${entry.workspace.slug}`)}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border p-2.5 text-sm transition-colors hover:border-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{entry.workspace.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {entry.workspace.kind} · {REVIEW_AUTOMATION_LABELS[entry.automation]}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs">
                    {entry.counts.pending > 0 && (
                      <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-background">
                        {entry.counts.pending} pending
                      </span>
                    )}
                    {entry.counts.pending === 0 && entry.counts.failed === 0 && (
                      <span className="text-muted-foreground">clear</span>
                    )}
                    {entry.counts.failed > 0 && (
                      <span className="ml-1 rounded-full bg-destructive px-2 py-0.5 font-medium text-background">
                        {entry.counts.failed} failed
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      {inbox.views.length === 0 ? (
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-medium">No entries yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            When a Codex or Claude session working in a lead or project workspace records a meeting,
            decision, risk, or fact, it writes one JSON file into that workspace&apos;s{" "}
            <code>Mi/inbox/</code> folder. Mi imports it here automatically — usually within twenty
            seconds — and waits for you.
          </p>
        </section>
      ) : (
        <ReviewInboxBrowser
          key={workspace ?? "all"}
          views={inbox.views}
          initialWorkspace={workspace ?? ""}
          workspaces={inbox.perWorkspace.map((entry) => ({
            key: `${entry.workspace.kind}/${entry.workspace.slug}`,
            label: entry.workspace.label,
            pending: entry.counts.pending,
            failed: entry.counts.failed,
          }))}
        />
      )}
    </div>
  );
}
