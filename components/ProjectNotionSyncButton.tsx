"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ActivityIndicator } from "@/components/UiState";
import { readJsonResponse } from "@/lib/readJsonResponse";
import type { FieldChange, SyncPlan } from "@/src/services/notionSync";

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Blank";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function changeLabel(change: FieldChange): string {
  if (change.record === "schedule" && change.field === "planned_date" && typeof change.to === "object") {
    return "New milestone";
  }
  return `${change.record === "project" ? "Project" : "Milestone"} ${change.field.replaceAll("_", " ")}`;
}

export function ProjectNotionSyncButton({ slug, projectName }: {
  slug: string;
  projectName: string;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ state: "success" | "error"; label: string } | null>(null);

  async function request(confirmed: boolean) {
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/notion-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed }),
    });
    const body = await readJsonResponse<{ plan: SyncPlan }>(response, "Notion synchronization failed.");
    return body.plan as SyncPlan;
  }

  async function preview() {
    setBusy(true);
    setFeedback(null);
    try {
      setPlan(await request(false));
    } catch (cause) {
      setFeedback({ state: "error", label: cause instanceof Error ? cause.message : "Could not preview the sync." });
    } finally {
      setBusy(false);
    }
  }

  // Dismissal must never depend on a request finishing: a slow or hung Notion call would
  // otherwise leave this modal with every button disabled and no way out. Closing only
  // dismisses the preview -- a sync already confirmed keeps running and still refreshes.
  function close() {
    setPlan(null);
  }

  useEffect(() => {
    if (!plan) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [plan]);

  async function apply() {
    setBusy(true);
    try {
      const applied = await request(true);
      setPlan(null);
      setFeedback({
        state: "success",
        label: applied.changes.length === 0
          ? "Already up to date."
          : `Synced ${applied.changes.filter((change) => change.allowed).length} allowed change(s).`,
      });
      router.refresh();
    } catch (cause) {
      setFeedback({ state: "error", label: cause instanceof Error ? cause.message : "Could not apply the sync." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="pointer-events-auto relative z-10 flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => void preview()}
          disabled={busy}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-50"
        >
          {busy ? <ActivityIndicator label="Checking Notion…" /> : "Sync Notion"}
        </button>
        {feedback && <ActivityIndicator state={feedback.state} label={feedback.label} className="max-w-64 text-right text-[10px]" />}
      </div>

      {plan && createPortal((
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`sync-${slug}-title`}
            className="w-full max-w-xl rounded-xl border border-border bg-card p-5 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-accent">Notion → Mi preview</p>
              <button
                type="button"
                onClick={close}
                aria-label="Close sync preview"
                className="-mr-1 -mt-1 rounded-md border border-transparent px-2 py-0.5 text-lg leading-none text-muted-foreground hover:border-border"
              >
                ×
              </button>
            </div>
            <h2 id={`sync-${slug}-title`} className="mt-1 font-display text-xl font-light">
              Sync {projectName}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This reads the confirmed Notion project and its linked schedule. Only allowlisted fields
              are written to Mi after you confirm; Notion is never changed.
            </p>
            <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-border">
              {plan.changes.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Mi is already up to date with Notion.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {plan.changes.map((change, index) => (
                    <li key={`${change.record}-${change.field}-${index}`} className="p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{changeLabel(change)}</span>
                        <span className={`text-[10px] uppercase tracking-wide ${change.allowed ? "text-accent" : "text-muted-foreground"}`}>
                          {change.allowed ? "Will update" : "View only"}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {displayValue(change.from)} → {displayValue(change.to)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-md border border-border px-3 py-2 text-sm">
                {busy ? "Close" : "Cancel"}
              </button>
              <button type="button" onClick={() => void apply()} disabled={busy} className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50">
                {busy ? <ActivityIndicator label="Syncing…" className="text-background" /> : plan.changes.some((change) => change.allowed) ? "Confirm sync to Mi" : "Confirm refresh"}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
