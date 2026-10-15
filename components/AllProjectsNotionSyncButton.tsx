"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ActivityIndicator } from "@/components/UiState";
import { readJsonResponse } from "@/lib/readJsonResponse";
import type { SyncPlan } from "@/src/services/notionSync";

interface Result {
  slug: string;
  name: string;
  status: "ready" | "applied" | "error";
  plan?: SyncPlan;
  error?: string;
}
export function AllProjectsNotionSyncButton() {
  const router = useRouter();
  const [results, setResults] = useState<Result[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ state: "success" | "error"; label: string } | null>(null);

  async function request(confirmed: boolean) {
    const response = await fetch("/api/projects/notion-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed }),
    });
    return readJsonResponse<{ projects: Result[]; skipped: number }>(response, "Notion synchronization failed.");
  }

  async function preview() {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await request(false);
      setResults(response.projects);
      setSkipped(response.skipped);
    } catch (error) {
      setFeedback({ state: "error", label: error instanceof Error ? error.message : "Could not preview Notion sync." });
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const response = await request(true);
      const changed = response.projects.reduce(
        (total, project) => total + (project.plan?.changes.filter((change) => change.allowed).length ?? 0),
        0,
      );
      const failed = response.projects.filter((project) => project.status === "error").length;
      setResults(null);
      setFeedback({ state: failed ? "error" : "success", label: `Synced ${changed} Mi update(s) across ${response.projects.length - failed} project(s)${failed ? `; ${failed} need review` : ""}.` });
      router.refresh();
    } catch (error) {
      setFeedback({ state: "error", label: error instanceof Error ? error.message : "Could not apply Notion sync." });
    } finally {
      setBusy(false);
    }
  }

  const allowedChanges = results?.reduce(
    (total, project) => total + (project.plan?.changes.filter((change) => change.allowed).length ?? 0),
    0,
  ) ?? 0;

  function closePreview() {
    setResults(null);
  }

  useEffect(() => {
    if (!results) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [results]);

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => void preview()}
          disabled={busy}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
        >
          {busy ? <ActivityIndicator label="Checking Notion…" /> : "Sync all linked projects"}
        </button>
        {feedback && <ActivityIndicator state={feedback.state} label={feedback.label} className="max-w-sm text-right text-xs" />}
      </div>
      {results && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={closePreview}>
          <div role="dialog" aria-modal="true" aria-labelledby="all-notion-sync-title" className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-xs font-medium uppercase tracking-wide text-accent">Notion → Mi preview</p>
            <h2 id="all-notion-sync-title" className="mt-1 font-display text-xl font-light">Review linked-project ingestion</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Mi read {results.length} human-confirmed project link(s). It found {allowedChanges} allowlisted
              update(s); {skipped} local-only project(s) were skipped. Notion will not be changed.
            </p>
            <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-border">
              {results.map((project) => (
                <div key={project.slug} className="border-b border-border p-3 last:border-b-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{project.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {project.status === "error"
                        ? "Needs review"
                        : `${project.plan?.changes.filter((change) => change.allowed).length ?? 0} update(s)`}
                    </span>
                  </div>
                  {project.error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{project.error}</p>}
                </div>
              ))}
              {results.length === 0 && <p className="p-4 text-sm text-muted-foreground">No confirmed Notion-linked projects are available.</p>}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              New Notion deadlines, midterm deadlines, kick-offs, and allowlisted project fields become Mi records after confirmation.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closePreview} className="rounded-md border border-border px-3 py-2 text-sm">{busy ? "Close" : "Cancel"}</button>
              <button type="button" onClick={() => void apply()} disabled={busy || results.length === 0} className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50">
                {busy ? <ActivityIndicator label="Syncing…" className="text-background" /> : "Confirm sync to Mi"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
