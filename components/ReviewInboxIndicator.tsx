"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "@/components/AppIcon";
import { publishCompanionInbox, type CompanionInboxEntry } from "@/lib/miniMi/inbox";

interface Announcement {
  cardId: string;
  kind: string;
  title: string;
  workspace: string;
  href: string;
}

interface CountPayload {
  perWorkspace?: CompanionInboxEntry[];
  scannedAt?: number | null;
  counts: { pending: number; failed: number; applied: number; dismissed: number; superseded: number };
  announcements: Announcement[];
}

const POLL_MS = 20_000;

/**
 * The mailbox link, its badge, and the arrival notice.
 *
 * One poller drives all three. The server decides what is new — it returns each card as an
 * announcement exactly once and records that it did — so a second window, a refresh, or a
 * restart cannot re-announce an entry that has already been seen. The notice is a corner
 * toast that dismisses itself: an import is worth knowing about, never worth interrupting
 * what someone is typing.
 */
export function ReviewInboxIndicator({ active }: { active: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [toasts, setToasts] = useState<Announcement[]>([]);
  const inFlight = useRef(false);
  const lastCounts = useRef<string | null>(null);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/review-inbox/count", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as CountPayload;
      publishCompanionInbox(data.perWorkspace ?? [], data.scannedAt ?? 0);
      setPending(data.counts.pending);
      setFailed(data.counts.failed);
      if (data.announcements.length > 0) {
        setToasts((current) => [...data.announcements, ...current].slice(0, 4));
      }
      // The shared folder is the source of truth, and a partner confirming a card on their
      // machine changes it without this one hearing about it. Every page reads the mailbox
      // on the server (force-dynamic), so re-rendering the current route on a count change
      // is what makes their confirmation visible here without anyone pressing reload. The
      // first poll only records the baseline: refreshing the page someone just opened would
      // be a wasted round trip, not an update.
      const signature = JSON.stringify(data.counts);
      if (lastCounts.current !== null && lastCounts.current !== signature) router.refresh();
      lastCounts.current = signature;
    } catch {
      // Offline or mid-restart: keep the last known count rather than flashing zero.
    } finally {
      inFlight.current = false;
    }
  }, [router]);

  useEffect(() => {
    // `poll` is a fetch: every setState inside it happens after an await, in the response
    // handler, not during this effect. The badge would otherwise stay blank until the first
    // interval fired twenty seconds later.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, not a sync setState
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [poll]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => setToasts((current) => current.slice(0, -1)), 12_000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  const total = pending + failed;

  return (
    <>
      <Link
        href="/review"
        className={`nav-link flex items-center gap-1.5 ${
          active ? "nav-link-active font-medium text-accent" : "text-muted-foreground transition-colors hover:text-foreground"
        }`}
      >
        <AppIcon name="inbox" className="h-4 w-4" />
        Review
        {total > 0 && (
          <span
            aria-label={`${pending} pending review card${pending === 1 ? "" : "s"}`}
            className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none ${
              failed > 0 && pending === 0
                ? "bg-destructive text-background"
                : "bg-accent text-background"
            }`}
          >
            {total}
          </span>
        )}
      </Link>

      {/* The header's backdrop filter contains fixed descendants. Render notices at
          the body so bottom-4 means the window's bottom, not the header's bottom. */}
      {toasts.length > 0 && createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex max-h-[calc(100dvh-2rem)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto">
          {toasts.map((toast) => (
            <div
              key={toast.cardId}
              role="status"
              className="animate-fade-in-up pointer-events-auto shrink-0 break-words rounded-lg border border-accent/60 bg-card p-3 shadow-[var(--shadow-sm)]"
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                New {toast.kind} · {toast.workspace}
              </p>
              <p className="mt-1 text-sm font-medium">{toast.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Captured for review. Nothing has been written yet.
              </p>
              <div className="mt-2 flex gap-2">
                <Link href="/review" className="text-xs text-link underline-offset-2 hover:underline">
                  Open Review Inbox
                </Link>
                <button
                  type="button"
                  onClick={() => setToasts((current) => current.filter((item) => item.cardId !== toast.cardId))}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
