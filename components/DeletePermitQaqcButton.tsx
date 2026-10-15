"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeletePermitQaqcButton({
  slug,
  name,
  compact = false,
}: {
  slug: string;
  name: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");

  async function remove() {
    setDeleting(true);
    setMessage("");
    const response = await fetch(`/api/permit-qaqc/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, expectedName: name }),
    }).catch(() => null);
    if (!response) {
      setMessage("Could not reach the local Mi server.");
      setDeleting(false);
      return;
    }
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setMessage(result.error ?? "Engagement could not be deleted.");
      setDeleting(false);
      return;
    }
    setConfirming(false);
    router.push("/permit-qaqc");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={compact
          ? "rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:border-red-500/60 hover:text-red-300"
          : "rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:border-red-500/70"}
      >
        Delete
      </button>
      {confirming && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby={`delete-permit-qaqc-${slug}`} className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
            <h2 id={`delete-permit-qaqc-${slug}`} className="font-medium">Delete {name}?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This removes the engagement record from Mi after confirmation. A recoverable local
              backup is retained; the real Dropbox folder and its files are not changed.
            </p>
            {message && <p role="alert" className="mt-3 text-sm text-red-300">{message}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => { setConfirming(false); setMessage(""); }}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void remove()}
                className="rounded-md bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
