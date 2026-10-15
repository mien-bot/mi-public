import { NextResponse } from "next/server";
import { readCachedReviewInbox } from "@/lib/content/reviewInboxCache";

export const dynamic = "force-dynamic";

/**
 * The mailbox badge's data source, and the only place workspace automation runs.
 *
 * Automation lives here rather than in a page render for one reason: a page render must
 * stay safe to repeat. This handler is polled, so "apply the entries the workspace setting
 * released" happens on a schedule a person can reason about, and a browser refresh cannot
 * become a write.
 *
 * The scan itself belongs to `reviewInboxCache`, not to this handler. Reading every
 * workspace inline made a 20s poll block Node's only thread for as long as the shared
 * Dropbox folder took to serve a few hundred files, which blanked the whole window. The
 * handler now answers from the last completed pass and lets the cache schedule the next
 * one, so a slow folder costs a stale badge rather than a dead app.
 *
 * Announcements are still returned once. The cache marks them as it hands them over --
 * rather than trusting the client to remember -- which is what stops the same import from
 * being announced again after a restart, a second window, or a different machine reading
 * the same shared folder.
 */
export async function GET() {
  try {
    const inbox = readCachedReviewInbox({ automate: true });
    return NextResponse.json({
      counts: inbox.counts,
      scannedAt: inbox.scannedAt,
      perWorkspace: inbox.perWorkspace.map((entry) => ({
        kind: entry.workspace.kind,
        slug: entry.workspace.slug,
        label: entry.workspace.label,
        href: entry.workspace.href,
        pending: entry.counts.pending,
        failed: entry.counts.failed,
      })),
      announcements: inbox.announcements.map((announcement) => ({
        cardId: announcement.cardId,
        kind: announcement.kind,
        title: announcement.title,
        workspace: announcement.workspace.label,
        href: announcement.workspace.href,
      })),
    });
  } catch {
    // The badge degrades to silence rather than to an error banner on every page.
    return NextResponse.json({
      counts: { pending: 0, failed: 0, applied: 0, dismissed: 0, superseded: 0 },
      perWorkspace: [],
      announcements: [],
    });
  }
}
