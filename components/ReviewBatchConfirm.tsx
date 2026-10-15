"use client";

import { useState } from "react";
import Link from "next/link";
import { loadMiProfile } from "./profilePreferences";
import { groupReviewSelection, reviewSelectionId } from "./reviewBatchSelection";
import type { ReviewCardView } from "@/lib/content/reviewInboxService";
import type { ReviewBatchPlan, ReviewBatchResult, ReviewBatchSelection } from "@/lib/content/reviewInboxBatch";

export function ReviewBatchConfirm({ selectedViews, onClearSelection, onApplied }: {
  selectedViews: ReviewCardView[];
  onClearSelection: () => void;
  onApplied: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ key: string; plan: ReviewBatchPlan } | null>(null);
  const [results, setResults] = useState<(ReviewBatchResult[number] & { label: string; href: string })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const groups = groupReviewSelection(selectedViews);
  const selection = groups.map(group => {
    const chosen = group.destinations.find(option => option.ref.kind === choices[group.key])
      ?? group.destinations.find(option => option.ref.kind === "project-notes")
      ?? group.destinations[0];
    return { kind: group.workspace.kind, slug: group.workspace.slug,
      cardIds: group.items.map(item => item.card.id), destinationKind: chosen?.ref.kind ?? "" };
  });
  const key = JSON.stringify([selection, selectedViews.map(view => [reviewSelectionId(view), view.card.status, view.content])]);
  const plan = preview?.key === key ? preview.plan : null;
  const blocked = selection.some(group => !group.destinationKind) || selectedViews.length > 100;

  async function run(action: "preview" | "confirm") {
    setBusy(true); setError(""); setResults(null);
    try {
      const response = await fetch("/api/review-inbox/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, groups: selection as ReviewBatchSelection,
          confirmed: action === "confirm", fingerprint: plan?.fingerprint,
          reviewedBy: loadMiProfile(window.localStorage).displayName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The batch could not be saved.");
      if (action === "preview") setPreview({ key, plan: data.plan });
      else {
        setResults((data.results as ReviewBatchResult).map(result => {
          const index = groups.findIndex(group => group.workspace.kind === result.kind && group.workspace.slug === result.slug);
          const workspace = groups[index]?.workspace;
          const destination = selection[index]?.destinationKind;
          const suffix = result.kind !== "project" ? "" : destination === "project-notes" ? "/knowledge" : destination === "project-meeting" ? "/meetings" : "";
          return { ...result, label: workspace?.label ?? result.slug, href: `${workspace?.href ?? "/review"}${suffix}` };
        }));
        setPreview(null); onClearSelection(); onApplied();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The batch could not be saved.");
      setPreview(null);
      if (action === "confirm") onApplied();
    } finally { setBusy(false); }
  }

  if (!selectedViews.length && !results && !error) return null;
  return <section aria-label="Batch review" className="rounded-xl border border-accent/50 bg-card p-4">
    {results && <div role="status" className="space-y-2 text-sm">
      <p className="font-medium">Saved {results.reduce((sum, result) => sum + result.applied, 0)} items across {results.length} workspaces.</p>
      {results.map(result => <div key={`${result.kind}/${result.slug}`}>
        <Link className="text-link underline" href={result.href}>
          {result.label}: {result.applied} saved{result.failed ? `, ${result.failed} need attention` : ""}
        </Link>
        {result.errors.map((message, index) => <p key={index} className="text-destructive">{message}</p>)}
        {result.warnings?.map((message, index) => <p key={`warning-${index}`} className="text-status-warning-foreground">{message}</p>)}
      </div>)}
      <p className="text-muted-foreground">Saved items leave Pending. Items that failed remain available to review or retry.</p>
      <p className="text-muted-foreground">For projects using local records, check Dropbox agent workspaces above to refresh their reference copies. Dropbox-shared project records are already updated.</p>
    </div>}
    {!!selectedViews.length && <>
      <h2 className="font-medium">{selectedViews.length} items · {groups.length} workspaces</h2>
      <p className="mt-1 text-sm text-muted-foreground">Review each project’s changes below, then accept the whole batch. Each item stays with its original project.</p>
      <fieldset disabled={busy} className="mt-3 space-y-3">
        {groups.map((group, index) => <div key={group.key} className="rounded-lg border border-border p-3">
          <label className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{group.workspace.label} · {group.items.length} items</span>
            <select aria-label={`Destination for ${group.workspace.label}`} value={selection[index].destinationKind}
              onChange={event => setChoices(current => ({ ...current, [group.key]: event.target.value }))}
              className="max-w-full rounded border border-border bg-background p-2">
              {!group.destinations.length && <option value="">No shared destination</option>}
              {group.destinations.map(option => <option key={option.ref.kind} value={option.ref.kind}>{option.label}</option>)}
            </select>
          </label>
          {!group.destinations.length && <p className="mt-2 text-sm text-destructive">These items need different destinations. Deselect an item to review this group together.</p>}
          {plan?.groups[index] && <div className="mt-3 space-y-3">
            {plan.groups[index].plan.blockers.map(message => <p key={message} className="text-sm text-destructive">{message}</p>)}
            {plan.groups[index].plan.effects.map(effect => <article key={effect.cardId} className="border-t border-border pt-2 text-sm">
              <h3 className="font-medium">{effect.title}</h3>
              <p className="text-xs text-muted-foreground">{effect.record} · {effect.summary}</p>
              <p className="mt-2 whitespace-pre-wrap break-words">{effect.proposed}</p>
            </article>)}
          </div>}
        </div>)}
      </fieldset>
      {selectedViews.length > 100 && <p role="alert" className="mt-2 text-sm text-destructive">Select up to 100 items per batch.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {plan ? <button disabled={busy || !plan.allowed} onClick={() => void run("confirm")} className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
          {busy ? "Saving…" : `Accept ${selectedViews.length} items across ${groups.length} workspaces`}
        </button> : <button disabled={busy || blocked} onClick={() => void run("preview")} className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
          {busy ? "Checking…" : "Review selected changes"}
        </button>}
        <button disabled={busy} onClick={onClearSelection} className="rounded-md border border-border px-3 py-2 text-sm">Clear selection</button>
      </div>
    </>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </section>;
}
