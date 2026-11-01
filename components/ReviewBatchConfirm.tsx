"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { loadMiProfile } from "./profilePreferences";
import { groupReviewSelection, reviewSelectionId } from "./reviewBatchSelection";
import type { ReviewCardView } from "@/lib/content/reviewInboxService";
import type { ReviewBatchPlan, ReviewBatchResult, ReviewBatchSelection } from "@/lib/content/reviewInboxBatch";

export function ReviewBatchConfirm({ selectedViews, onClearSelection, onDeselect, onApplied }: {
  selectedViews: ReviewCardView[];
  onClearSelection: () => void;
  onDeselect: (ids: string[]) => void;
  onApplied: () => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [folders, setFolders] = useState<Record<string, string>>({});
  const [folderError, setFolderError] = useState("");
  const [preview, setPreview] = useState<{ key: string; plan: ReviewBatchPlan } | null>(null);
  const [results, setResults] = useState<(ReviewBatchResult[number] & { label: string; href: string })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const groups = groupReviewSelection(selectedViews);
  const selection = groups.map(group => {
    const chosen = group.destinations.find(option => option.ref.kind === choices[group.key])
      ?? group.destinations.find(option => option.ref.kind === "project-notes")
      ?? group.destinations.find(option => option.ref.kind === "qaqc-memory")
      ?? group.destinations[0];
    const folder = chosen?.ref.kind === "workspace-folder" ? folders[group.key]?.trim() || undefined : undefined;
    return { kind: group.workspace.kind, slug: group.workspace.slug,
      cardIds: group.items.map(item => item.card.id), destinationKind: chosen?.ref.kind ?? "", folder };
  });
  const key = JSON.stringify([selection, selectedViews.map(view => [reviewSelectionId(view), view.card.status, view.content])]);
  const plan = preview?.key === key ? preview.plan : null;
  const blocked = selection.some(group => !group.destinationKind
    || (group.destinationKind === "workspace-folder" && !group.folder)) || selectedViews.length > 100;
  const hasNativePicker = typeof window !== "undefined" && Boolean(window.electronAPI?.dropbox?.pickFolderWithin);

  async function pickFolder(groupKey: string, folderRoot: string) {
    setFolderError("");
    const result = await window.electronAPI?.dropbox.pickFolderWithin(folderRoot);
    if (!result || result.canceled) return;
    if (result.error) return setFolderError(result.error);
    setFolders(current => ({ ...current, [groupKey]: result.relativePath ?? "." }));
  }

  useEffect(() => {
    if (plan) { previewRef.current?.focus(); previewRef.current?.scrollIntoView({ block: "nearest" }); }
  }, [plan]);

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
          const suffix = result.kind !== "project" ? "" : destination === "project-notes" ? "/knowledge" : destination === "project-meeting" ? "/meetings" : "";          return { ...result, label: workspace?.label ?? result.slug, href: `${workspace?.href ?? "/review"}${suffix}` };
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
    </div>}
    {!!selectedViews.length && <>
      <h2 className="font-medium">{selectedViews.length} items · {groups.length} workspaces</h2>
      <p className="mt-1 text-sm text-muted-foreground">Review each project’s changes below, then accept the whole batch. Each item stays with its original project.</p>
      {plan && <div ref={previewRef} tabIndex={-1} className="mt-3 text-sm font-medium">Review changes, then choose Save below.</div>}
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
          {!group.destinations.length && <div className="mt-2 text-sm text-destructive">
            <p>{group.reasons.join(" ") || "These items can’t be saved together."}</p>
            {!!group.unsavable.length && group.unsavable.length < group.items.length && <p>{group.unsavable.length} of these items can’t be saved.</p>}
          </div>}
          {!!group.unsavable.length && <button type="button" onClick={() => onDeselect(group.unsavable.map(reviewSelectionId))}
            className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm">
            Deselect {group.unsavable.length} {group.unsavable.length === 1 ? "item" : "items"} that can’t be saved
          </button>}
          {selection[index].destinationKind === "workspace-folder" && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {hasNativePicker
              ? <>
                <button type="button" onClick={() => void pickFolder(group.key, group.destinations.find(option => option.requiresFolder)?.folderRoot ?? "")}
                  className="rounded-md border border-border px-3 py-1.5">Choose folder</button>
                <span className="break-all text-muted-foreground">{folders[group.key] ? (folders[group.key] === "." ? "Project’s main folder" : folders[group.key]) : "No folder chosen"}</span>
              </>
              : <input aria-label={`Folder for ${group.workspace.label}`} placeholder="Folder inside the project’s Dropbox folder"
                value={folders[group.key] ?? ""} onChange={event => setFolders(current => ({ ...current, [group.key]: event.target.value }))}
                className="w-full max-w-md rounded border border-border bg-background p-2" />}
            <span className="w-full text-xs text-muted-foreground">Notes are added to “Mi Review Notes.md” in that folder.</span>
          </div>}
          {folderError && <p role="alert" className="mt-2 text-sm text-destructive">{folderError}</p>}
          {plan?.groups[index] && <div className="mt-3">
            {plan.groups[index].plan.blockers.map(message => <p key={message} className="text-sm text-destructive">{message}</p>)}
            <ul className="divide-y divide-border">
              {plan.groups[index].plan.effects.map(effect => <li key={effect.cardId} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h3 className="font-medium">{effect.title}</h3>
                  <span className="text-xs text-muted-foreground">{effect.destination}</span>
                </div>
                {effect.excerpt && <p className="mt-0.5 text-muted-foreground">{effect.excerpt}</p>}
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Show full text</summary>
                  <p className="mt-1 text-xs text-muted-foreground">{effect.record}</p>
                  <p className="mt-2 whitespace-pre-wrap break-words">{effect.proposed}</p>
                </details>
              </li>)}
            </ul>
          </div>}
        </div>)}
      </fieldset>
      {selectedViews.length > 100 && <p role="alert" className="mt-2 text-sm text-destructive">Select up to 100 items per batch.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {plan ? <button disabled={busy || !plan.allowed} onClick={() => void run("confirm")} className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
          {busy ? "Saving…" : `Save ${selectedViews.length} items`}
        </button> : <button disabled={busy || blocked} onClick={() => void run("preview")} className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
          {busy ? "Checking…" : "Preview save"}
        </button>}
        <button disabled={busy} onClick={onClearSelection} className="rounded-md border border-border px-3 py-2 text-sm">Clear selection</button>
      </div>
    </>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </section>;
}
