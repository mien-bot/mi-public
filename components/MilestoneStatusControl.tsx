"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dateInTimezone } from "@/lib/content/timezone";
import { usePersonalTimezone } from "./usePersonalTimezone";

type MilestoneCompletionStatus = "active" | "complete";

/**
 * Body for PATCH /api/projects/[slug]/schedule. Extracted so the field list -- especially
 * expectedHash, which the route rejects the whole request for omitting -- is covered by a test
 * rather than only by clicking Submit in the app.
 */
export function milestoneStatusPatchBody({
  id,
  plannedDate,
  draft,
  notionLinked,
  scheduleHash,
  today,
}: {
  id: string;
  plannedDate: string;
  draft: MilestoneCompletionStatus;
  notionLinked: boolean;
  scheduleHash: string | null;
  today: string;
}) {
  return {
    id,
    plannedDate: plannedDate.slice(0, 10),
    actualDate: draft === "complete" ? today : null,
    syncNotion: notionLinked,
    confirmed: true,
    expectedHash: scheduleHash,
  };
}

export function MilestoneStatusControl({
  slug,
  id,
  plannedDate,
  completedDate,
  notionLinked,
  scheduleHash,
}: {
  slug: string;
  id: string;
  plannedDate: string;
  completedDate: string | null;
  notionLinked: boolean;
  /**
   * Hash of schedule.yaml as this page rendered it. The PATCH route requires it so it can
   * refuse a write that would land on top of someone else's edit. Kept as a prop rather than
   * state so that router.refresh() after one milestone saves also re-arms every sibling
   * control on the page with the new hash.
   */
  scheduleHash: string | null;
}) {
  const router = useRouter();
  const { timezone } = usePersonalTimezone();
  const current: MilestoneCompletionStatus = completedDate ? "complete" : "active";
  const [draft, setDraft] = useState<MilestoneCompletionStatus>(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(milestoneStatusPatchBody({
          id,
          plannedDate,
          draft,
          notionLinked,
          scheduleHash,
          today: dateInTimezone(new Date(), timezone),
        })),
      });
      const result = await response.json();
      if (result.error === "conflict") {
        throw new Error("This schedule changed elsewhere since the page loaded. Reload and review the latest schedule before saving again.");
      }
      if (!response.ok) throw new Error(result.error ?? "Could not update milestone status.");
      setMessage(draft === "complete" ? "Completed." : "Returned to active deadlines.");
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not update milestone status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="group mt-2">
      <summary className="w-fit cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground group-open:text-foreground">
        <span className="group-open:hidden">Change status</span>
        <span className="hidden group-open:inline">Hide status editor</span>
      </summary>
      <div className="mt-2 border-t border-border pt-2">
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`milestone-status-${id}`}>Milestone status</label>
          <select
            id={`milestone-status-${id}`}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value as MilestoneCompletionStatus);
              setMessage("");
            }}
            disabled={busy}
            className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-accent"
          >
            <option value="active">Active / incomplete</option>
            <option value="complete">Complete</option>
          </select>
          <button
            type="button"
            onClick={submit}
            disabled={busy || draft === current}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "Submit"}
          </button>
        </div>
        {message && <p className="mt-2 text-xs text-muted-foreground" role="status">{message}</p>}
      </div>
    </details>
  );
}

export function RefreshMilestonesFromNotion({ slug, notionLinked }: {
  slug: string;
  notionLinked: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "refresh-notion-status", confirmed: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not refresh Notion statuses.");
      const fallback = result.observedCompletionDates > 0
        ? ` ${result.observedCompletionDates} completed item(s) had no Completed Date, so Mi recorded today.`
        : "";
      setMessage(`Refreshed ${result.matched} linked milestone(s).${fallback}`);
      setConfirming(false);
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not refresh Notion statuses.");
    } finally {
      setBusy(false);
    }
  }

  if (!notionLinked) return null;

  return (
    <div className="text-right">
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent"
        >
          Refresh statuses from Notion
        </button>
      ) : (
        <div className="rounded-md border border-border bg-card p-3 text-left text-xs">
          <p>This reads linked Notion Status and Completed Date values, then updates Mi.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={busy}
              className="rounded-md bg-accent px-3 py-1.5 text-accent-foreground disabled:opacity-50"
            >
              {busy ? "Refreshing…" : "Submit refresh"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && <p className="mt-2 max-w-sm text-xs text-muted-foreground" role="status">{message}</p>}
    </div>
  );
}
