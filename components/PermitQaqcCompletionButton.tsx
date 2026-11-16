"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PERMIT_QAQC_DEFAULT_REOPEN_STATUS, type PermitQaqcStatus } from "@/lib/schema";

export function PermitQaqcCompletionButton({
  slug,
  name,
  status,
  reopenStatus,
}: {
  slug: string;
  name: string;
  status: PermitQaqcStatus;
  reopenStatus: PermitQaqcStatus | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const action = status === "closed" ? "reopen" : "complete";
  const label = action === "complete" ? "Complete" : "Reopen";

  async function apply() {
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/permit-qaqc/${encodeURIComponent(slug)}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, confirmed: true, expectedName: name }),
    }).catch(() => null);
    if (!response) {
      setMessage("Could not reach the local Mi server.");
      setSaving(false);
      return;
    }
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setMessage(result.error ?? "Engagement could not be updated.");
      setSaving(false);
      return;
    }
    setConfirming(false);
    setSaving(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:border-accent hover:text-foreground"
      >
        {label}
      </button>
      {confirming && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby={`completion-permit-qaqc-${slug}`} className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
            <h2 id={`completion-permit-qaqc-${slug}`} className="font-medium">{label} {name}?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {action === "complete"
                ? `This saves the engagement as completed and moves it from the active list to Completed. Nothing is deleted, and Reopen returns it to ${status}. Save any edits on this page first.`
                : `This returns the engagement to the active list with status ${reopenStatus ?? PERMIT_QAQC_DEFAULT_REOPEN_STATUS}.`}
            </p>
            {message && <p role="alert" className="mt-3 text-sm text-red-300">{message}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => { setConfirming(false); setMessage(""); }}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void apply()}
                className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
              >
                {saving ? "Saving…" : `Confirm ${label.toLowerCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
