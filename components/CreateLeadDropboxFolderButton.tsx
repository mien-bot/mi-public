"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateLeadDropboxFolderButton({ slug, dropboxPath }: { slug: string; dropboxPath: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function create() {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/leads/${encodeURIComponent(slug)}/dropbox-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    }).catch(() => null);
    if (!response) {
      setMessage("Could not reach the local Mi server.");
      setBusy(false);
      return;
    }
    const result = (await response.json().catch(() => ({}))) as { error?: string; created?: boolean };
    if (!response.ok) {
      setMessage(result.error ?? "Could not create the folder.");
      setBusy(false);
      return;
    }
    setBusy(false);
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirming(true)}
        className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
      >
        {busy ? "Creating…" : `Create "${dropboxPath}" in Dropbox`}
      </button>
      {message && <p role="alert" className="text-sm text-red-300">{message}</p>}
      {confirming && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-border bg-card p-5">
            <h2 className="font-medium">Confirm Dropbox folder creation</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Create <code>{dropboxPath}</code> with contracts, owner-supplied, site-photos,
              correspondence, and Mi subfolders. Existing Dropbox content will not be overwritten.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void create()} className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50">
                {busy ? "Creating…" : "Confirm and create folders"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
