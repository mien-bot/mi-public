"use client";

import { useEffect, useState } from "react";
import type { FirmDataMigrationPreview, FirmDataMigrationResultEntry } from "@/types/electron";

export function FirmDataMigrationPanel() {
  const [mounted, setMounted] = useState(false);
  const [path, setPathValue] = useState<string | null>(null);
  const [migrated, setMigrated] = useState(false);
  const [preview, setPreview] = useState<{ clients: FirmDataMigrationPreview; leads: FirmDataMigrationPreview } | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<{ clients: FirmDataMigrationResultEntry[]; leads: FirmDataMigrationResultEntry[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe Electron capability check
    setMounted(true);
    const api = window.electronAPI?.setup;
    if (!api) return;
    api.get().then(({ config }) => {
      setPathValue(config.dropboxFirmDataPath);
      setMigrated(config.dropboxFirmDataMigrated);
    });
  }, []);

  if (!mounted || !window.electronAPI?.firmData || !path || migrated) return null;

  async function action(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadPreview() {
    setResults(null);
    const next = await window.electronAPI!.firmData.previewMigration();
    setPreview(next);
    setIncluded(new Set());
  }

  async function apply() {
    if (!preview) return;
    const data = await window.electronAPI!.firmData.applyMigration({
      clientsPreview: preview.clients,
      leadsPreview: preview.leads,
      includeRelativePaths: [...included],
      confirmed: true,
    });
    setResults({ clients: data.clients, leads: data.leads });
    setConfirming(false);
    if (data.migrationComplete) {
      setMessage("Firm-wide data migration complete. Clients and leads now live in Dropbox.");
      setPreview(null);
      setMigrated(true);
    } else {
      setMessage("Some files need review before migration can finish — see below, then preview again.");
    }
  }

  const needsReview = [...(preview?.clients.entries ?? []), ...(preview?.leads.entries ?? [])]
    .filter((entry) => entry.status === "needs-review");
  const willCopyCount = [...(preview?.clients.entries ?? []), ...(preview?.leads.entries ?? [])]
    .filter((entry) => entry.status === "will-copy").length;

  return (
    <section className="rounded-lg border border-border p-5">
      <h2 className="font-medium">Migrate firm-wide data to Dropbox</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Copies clients and leads into the shared folder above so every installed Mi linked to
        this Dropbox sees the same list. Local copies are kept as a historical backup, never
        deleted.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void action(loadPreview)}
        className="mt-4 rounded-md border border-border px-3 py-2 text-sm"
      >
        Preview migration
      </button>

      {preview && (
        <div className="mt-4 space-y-3 text-sm">
          <p className="text-muted-foreground">
            {willCopyCount} file(s) will be copied, {needsReview.length} need review.
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
            disabled={busy || (willCopyCount === 0 && included.size === 0)}
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
          {[...results.clients, ...results.leads].map((result) => (
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
            <h2 className="font-medium">Confirm firm-wide data migration</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {willCopyCount + included.size} file(s) will be copied to the shared Dropbox
              folder. Local copies stay in place as a backup.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-3 py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(apply)}
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
