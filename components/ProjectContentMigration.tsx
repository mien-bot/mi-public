"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PreviewEntry {
  relativePath: string;
  status: "will-copy" | "identical" | "needs-review";
  sourceHash: string;
  destHash: string | null;
}

interface ResultEntry {
  relativePath: string;
  status: "copied" | "skipped" | "failed";
  error?: string;
}

export function ProjectContentMigration({ slug }: { slug: string }) {
  const router = useRouter();
  const [entries, setEntries] = useState<PreviewEntry[] | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<ResultEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadPreview() {
    setBusy(true);
    setMessage("");
    setResults(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/content-migration`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setEntries(data.preview.entries);
      setIncluded(new Set());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/content-migration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, includeRelativePaths: [...included] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResults(data.results);
      setConfirming(false);
      if (data.migrationComplete) {
        setMessage("Migration complete. This project's data now lives in Dropbox.");
        setEntries(null);
        router.refresh();
      } else {
        setMessage("Some files need review before migration can finish — see below, then preview again.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Migration failed.");
    } finally {
      setBusy(false);
    }
  }

  const needsReview = (entries ?? []).filter((entry) => entry.status === "needs-review");
  const willCopy = (entries ?? []).filter((entry) => entry.status === "will-copy");
  const identical = (entries ?? []).filter((entry) => entry.status === "identical");

  return (
    <section className="rounded-lg border border-border p-5">
      <h2 className="font-medium">Migrate this project&apos;s data to Dropbox</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Copies this project&apos;s Mi data (schedule, details, meetings, etc.) into the shared
        Dropbox folder so a second installed Mi linked to the same Dropbox sees it. The local
        copy is never deleted — it&apos;s kept as a historical backup. Nothing happens until you
        review and confirm.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void loadPreview()}
        className="mt-4 rounded-md border border-border px-3 py-2 text-sm"
      >
        Preview migration
      </button>

      {entries && (
        <div className="mt-4 space-y-3 text-sm">
          <p className="text-muted-foreground">
            {willCopy.length} file(s) will be copied, {identical.length} already match, {needsReview.length} need review.
          </p>
          {needsReview.length > 0 && (
            <div className="rounded-md border border-status-warning-foreground/40 bg-status-warning/30 p-3">
              <p className="font-medium">These differ at the destination — include only if you want to overwrite them:</p>
              <ul className="mt-2 space-y-1">
                {needsReview.map((entry) => (
                  <li key={entry.relativePath} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={included.has(entry.relativePath)}
                      onChange={(event) => setIncluded((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(entry.relativePath); else next.delete(entry.relativePath);
                        return next;
                      })}
                    />
                    <code className="text-xs">{entry.relativePath}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            disabled={busy || (willCopy.length === 0 && included.size === 0)}
            onClick={() => setConfirming(true)}
            className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
          >
            Review and confirm
          </button>
        </div>
      )}

      {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
      {results && (
        <ul className="mt-3 space-y-1 text-sm">
          {results.map((result) => (
            <li key={result.relativePath}>
              <code className="text-xs">{result.relativePath}</code>: {result.status}
              {result.error ? ` — ${result.error}` : ""}
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-border bg-card p-5">
            <h2 className="font-medium">Confirm content migration</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {willCopy.length + included.size} file(s) will be copied to the shared Dropbox
              folder. The local copy stays in place as a backup. This project will start reading
              and writing from Dropbox once migration completes.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-3 py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void apply()}
                className="rounded-md bg-foreground px-3 py-2 text-sm text-background"
              >
                {busy ? "Migrating…" : "Confirm and migrate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
