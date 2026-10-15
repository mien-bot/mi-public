"use client";

import { useState } from "react";
import Link from "next/link";
import { loadMiProfile } from "@/components/profilePreferences";
import type { BulkApplyPlan } from "@/lib/content/reviewInboxApply";
import type { ReviewCardView } from "@/lib/content/reviewInboxService";

function selectionKey(views: ReviewCardView[]): string {
  return views.map((view) => view.card.id).sort().join("|");
}

/**
 * Confirming several review cards in one action.
 *
 * Lives in its own component because the mailbox is not the only place a stack of cards
 * builds up: a project or lead page shows its own pending cards, and clearing eight of them
 * there used to mean eight round trips through the mailbox. Both surfaces render this, so
 * neither can drift into a different idea of what bulk confirmation allows.
 *
 * The plan is tagged with the selection it was computed for rather than cleared by the
 * caller. A previewed plan shown above a changed selection is exactly how someone confirms
 * a write they never read, and tying the two together makes that unrepresentable instead of
 * relying on every caller to remember.
 */
export function ReviewBulkConfirm({
  selectedViews,
  onClearSelection,
  onApplied,
}: {
  selectedViews: ReviewCardView[];
  onClearSelection: () => void;
  /** Called after a successful bulk apply, to refresh whatever list is showing. */
  onApplied: () => void;
}) {
  const [plannedFor, setPlannedFor] = useState("");
  const [plan, setPlan] = useState<BulkApplyPlan | null>(null);
  const [chosenDestination, setChosenDestination] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedKnowledgeHref, setSavedKnowledgeHref] = useState("");

  const key = selectionKey(selectedViews);
  const currentPlan = plannedFor === key ? plan : null;
  const workspaces = new Set(selectedViews.map((view) => `${view.workspace.kind}/${view.workspace.slug}`));
  const workspace = selectedViews[0]?.workspace ?? null;

  // Only destinations every selected card can actually reach.
  const destinations = selectedViews.length > 0 && workspaces.size === 1
    ? selectedViews[0].destinations.filter((option) =>
      selectedViews.every((view) =>
        view.destinations.some((candidate) => candidate.ref.kind === option.ref.kind && candidate.available)))
    : [];
  /**
   * Derived rather than stored, so it cannot go stale: a destination the current selection
   * can no longer reach is dropped instead of silently staying chosen, and the single
   * available destination -- the ordinary case -- needs no click at all.
   */
  const destination = destinations.some((option) => option.ref.kind === chosenDestination)
    ? chosenDestination
    : destinations.some((option) => option.ref.kind === "project-notes")
      ? "project-notes"
    : destinations.length === 1
      ? destinations[0].ref.kind
      : "";

  async function run(action: "bulk-preview" | "bulk-confirm") {
    if (!workspace || !destination) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/review-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: workspace.kind,
          slug: workspace.slug,
          action,
          cardIds: selectedViews.map((view) => view.card.id),
          destination,
          confirmed: action === "bulk-confirm",
          previewFingerprint: action === "bulk-confirm" ? currentPlan?.fingerprint : undefined,
          reviewedBy: typeof window === "undefined" ? "" : loadMiProfile(window.localStorage).displayName,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The bulk action could not be completed.");
      if (action === "bulk-preview") {
        setPlannedFor(key);
        setPlan(data.plan);
        return;
      }
      setPlan(null);
      setPlannedFor("");
      setChosenDestination("");
      setMessage(data.message);
      if (destination === "project-notes" && workspace.kind === "project") {
        setSavedKnowledgeHref(`/projects/${workspace.slug}/knowledge`);
      }
      onClearSelection();
      onApplied();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The bulk action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (selectedViews.length === 0) return message ? (
    <div role="status" className="rounded-lg border border-accent bg-accent/5 p-4 text-sm">
      {message} {savedKnowledgeHref && <Link href={savedKnowledgeHref} className="text-link underline">Open saved project knowledge</Link>}
    </div>
  ) : null;

  return (
    <section className="rounded-lg border border-accent/60 bg-accent/5 p-4" aria-label="Bulk confirmation">
      <p className="text-sm font-medium">{selectedViews.length} card(s) selected</p>
      {workspaces.size > 1 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Selected cards belong to {workspaces.size} workspaces. Bulk confirmation applies to one
          workspace at a time — narrow the Workspace filter above, then select again.
        </p>
      ) : destinations.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          No one destination can take every selected card. Each card lists its own reasons under
          its buttons; confirm those individually, or deselect the odd ones out.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {destinations.length === 1 ? (
            <span className="text-sm">
              All {selectedViews.length} go to{" "}
              <span className="font-medium">{destination === "project-notes" ? "Project knowledge" : destinations[0].record}</span>.
            </span>
          ) : (
            <select
              aria-label="Save selected items to"
              value={destination}
              onChange={(event) => { setChosenDestination(event.target.value); setPlan(null); setPlannedFor(""); }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            >
              <option value="">Choose a destination…</option>
              {destinations.map((option) => (
                <option key={option.ref.kind} value={option.ref.kind}>{option.label}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={!destination || busy}
            onClick={() => void run("bulk-preview")}
            className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {busy && !currentPlan ? "Checking…" : destination === "project-notes" ? "Review selected knowledge" : "Review selected changes"}
          </button>
        </div>
      )}
      <button type="button" disabled={busy} onClick={onClearSelection}
        className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-60">Clear selection</button>

      {currentPlan && (
        <div className="mt-3 rounded-md border border-border bg-background p-3 text-sm">
          {currentPlan.blockers.length > 0 && (
            <ul className="mb-2 list-disc space-y-0.5 pl-5 text-destructive">
              {currentPlan.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          )}
          <ul className="space-y-1">
            {currentPlan.effects.map((effect) => (
              <li key={effect.cardId} className="text-xs">
                <span className="font-medium">{effect.title}</span> → <span className="font-mono">{effect.record}</span>
                {" — "}{effect.summary}
                <details className="mt-2 rounded border border-border p-2" open>
                  <summary className="cursor-pointer">{destination === "project-notes" ? "Knowledge to save" : "Changes to save"}</summary>
                  <p className="mt-2 whitespace-pre-wrap break-words">{effect.proposed}</p>
                </details>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={!currentPlan.allowed || busy}
            onClick={() => void run("bulk-confirm")}
            className="mt-3 rounded-md bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-60"
          >
            {busy ? "Saving…" : destination === "project-notes" ? `Save ${currentPlan.effects.length} items as project knowledge` : `Confirm all ${currentPlan.effects.length}`}
          </button>
        </div>
      )}

      {message && <p className="mt-2 text-sm">{message}</p>}
    </section>
  );
}
