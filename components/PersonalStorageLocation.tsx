"use client";

import { useEffect, useState } from "react";
import type { PersonalDataMigrationPreview } from "@/types/electron";

export function PersonalStorageLocation() {
  const [mounted, setMounted] = useState(false);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<PersonalDataMigrationPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [needsOverwriteConfirm, setNeedsOverwriteConfirm] = useState(false);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe Electron capability check
    setMounted(true);
    const api = window.electronAPI?.setup;
    if (!api) return;
    api.get().then(({ config }) => setCurrentPath(config.personalDataRoot));
  }, []);

  if (!mounted || !window.electronAPI?.personalData) return null;

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

  async function chooseNewLocation() {
    const picked = await window.electronAPI!.setup.pickPersonalDataRoot();
    if (picked.canceled || !picked.path) return;
    const next = await window.electronAPI!.personalData.previewMigration(picked.path);
    setPreview(next);
    setNeedsOverwriteConfirm(false);
    setChanged(false);
    setConfirming(true);
  }

  async function apply(confirmOverwrite: boolean) {
    if (!preview) return;
    const result = await window.electronAPI!.personalData.applyMigration({ preview, confirmed: true, confirmOverwrite });
    if (result.status === "needs-review") {
      setNeedsOverwriteConfirm(true);
      setMessage(result.error || "That folder already has different personal data.");
      return;
    }
    setConfirming(false);
    setNeedsOverwriteConfirm(false);
    setPreview(null);
    setChanged(true);
    setCurrentPath(result.personalDataRoot ?? preview.destDir);
    setMessage("Personal data now points to the new folder. Restart Mi for the change to take effect everywhere.");
  }

  return (
    <section className="rounded-lg border border-border p-5">
      <h2 className="font-medium">Where your personal data is stored</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your journal, thoughts, tasks, and plans live in one local file on this computer, never
        shared or synced unless you explicitly confirm a STUDIO share.
      </p>
      <p className="mt-3 break-all rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs">
        {currentPath ?? "…"}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void action(() => window.electronAPI!.personalData.reveal())}
          className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50"
        >
          Reveal in folder
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void action(chooseNewLocation)}
          className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50"
        >
          Change location…
        </button>
        {changed && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void action(() => window.electronAPI!.setup.restartServer())}
            className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
          >
            Restart Mi now
          </button>
        )}
      </div>

      {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}

      {needsOverwriteConfirm && preview && (
        <div className="mt-3 rounded-md border border-status-warning-foreground/40 bg-status-warning/30 p-3 text-sm">
          <p>
            That folder already has different personal data. Overwriting replaces its contents
            with what&apos;s currently in Mi.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setPreview(null); setNeedsOverwriteConfirm(false); setMessage(""); }}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void action(() => apply(true))}
              className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
            >
              Overwrite and use this folder
            </button>
          </div>
        </div>
      )}

      {confirming && preview && !needsOverwriteConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-border bg-card p-5">
            <h2 className="font-medium">Move personal data?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {preview.status === "nothing-to-copy"
                ? "There's nothing to copy yet -- Mi will start writing new personal data to:"
                : preview.status === "identical"
                  ? "That folder already has the exact same data. Mi will just start reading from:"
                  : "Mi will copy your current journal, thoughts, tasks, and plans to:"}
            </p>
            <p className="mt-2 break-all rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs">
              {preview.destDir}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              The current copy stays in place as a backup. Nothing is deleted.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setConfirming(false); setPreview(null); }}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(() => apply(false))}
                className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
              >
                {busy ? "Moving…" : "Confirm and move"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
