"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import type {
  AllProjectHarnessApplyResult,
  AllProjectHarnessPreview,
} from "@/types/electron";

export function canSubmitAllProjectHarness(
  previewId: string | null,
  confirmed: boolean,
  pending: boolean,
) {
  return Boolean(previewId && confirmed && !pending);
}

export function AllProjectHarnessManager() {
  const desktop = useSyncExternalStore(
    () => () => {},
    () => window.electronAPI?.isElectron === true,
    () => false,
  );
  const [preview, setPreview] = useState<AllProjectHarnessPreview | null>(null);
  const [result, setResult] = useState<AllProjectHarnessApplyResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!desktop) return <p className="text-sm text-muted-foreground">Open Mi’s desktop app to check or update Dropbox agent workspaces.</p>;

  async function previewAll() {
    setPending(true);
    setError(null);
    setResult(null);
    setConfirmed(false);
    try {
      setPreview(await window.electronAPI!.harness.previewAll());
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  async function applyAll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || !canSubmitAllProjectHarness(preview.previewId, confirmed, pending)) return;
    setPending(true);
    setError(null);
    try {
      setResult(await window.electronAPI!.harness.applyAll(preview.previewId, true));
      setPreview(null);
      setConfirmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="all-project-harness-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="all-project-harness-title" className="font-display text-lg font-light">
            Dropbox agent workspaces
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Check the Mi guides and inbox folders in your linked Dropbox projects. Review any changes before updating them; your own notes are preserved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* The applied-results list runs to hundreds of lines across every project, and
              without this the only way back to a clean page was a reload. */}
          {(preview || result) && (
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setResult(null);
                setConfirmed(false);
                setError(null);
              }}
              disabled={pending}
              className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
            >
              Hide
            </button>
          )}
          <button
            type="button"
            onClick={previewAll}
            disabled={pending}
            className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            {pending && !preview ? "Checking…" : "Check linked workspaces"}
          </button>
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-destructive" role="alert">{error}</p> : null}

      {preview ? (
        <form className="mt-5 space-y-4" onSubmit={applyAll}>
          <p className="text-sm font-medium" role="status">
            {preview.projects.filter(project => project.status === "ready").length} ready to review ·{" "}
            {preview.projects.filter(project => project.status === "error").length} need attention ·{" "}
            {preview.skipped.length} unlinked
          </p>
          <div className="space-y-3">
            {preview.projects.map((project) => (
              <div key={project.slug} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{project.name} <span className="text-muted-foreground">({project.slug})</span></p>
                  <code className="text-xs text-muted-foreground">{project.dropboxPath || "No linked path"}</code>
                </div>
                {project.status === "error" ? (
                  <p className="mt-2 text-destructive">{project.error} <Link href={`/projects/${project.slug}/files`} className="underline">Check project folder</Link></p>
                ) : (
                  <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    {project.entries.map((entry) => (
                      <li key={entry.relativePath}><span className="uppercase">{entry.action}</span> {entry.relativePath}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {preview.skipped.length ? (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">Skipped unlinked projects</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {preview.skipped.map((project) => (
                  <li key={project.slug}>{project.name}: {project.reason} <Link href={`/projects/${project.slug}/files`} className="text-link underline">Link folder</Link></li>
                ))}
              </ul>
            </div>
          ) : null}

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5"
            />
            <span>Apply this exact preview to every project marked ready.</span>
          </label>
          <button
            type="submit"
            disabled={!canSubmitAllProjectHarness(preview.previewId, confirmed, pending) || !preview.projects.some(project => project.status === "ready")}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Updating…" : "Update reviewed workspaces"}
          </button>
        </form>
      ) : null}

      {result ? (
        <div className="mt-5 space-y-3" aria-live="polite">
          {result.projects.map((project) => (
            <div key={project.previewId} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">{project.name}: {project.status === "partial" ? "Some files need attention — check again before retrying" : project.status === "applied" ? "Workspace checked and updated" : "Needs attention"}</p>
              {project.status === "failed" ? (
                <p className="mt-2 text-destructive">{project.error}</p>
              ) : (
                <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  {project.results.map((entry) => (
                    <li key={entry.relativePath}>{entry.status.toUpperCase()} {entry.relativePath}{entry.error ? `: ${entry.error}` : ""}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
