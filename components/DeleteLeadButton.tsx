"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Typing the word is the last gate before an irreversible-looking action: it makes deleting a
 * lead impossible to reach by reflex from a dialog that appeared mid-scan. Matched
 * case-insensitively and trimmed -- this guards against an accidental click, not a determined
 * user. */
const CONFIRM_WORD = "delete";

export function DeleteLeadButton({
  slug,
  name,
  convertedProjectSlug = null,
  compact = false,
}: {
  slug: string;
  name: string;
  /** Set when this lead already converted to a project -- deleting it drops the "converted
   * from lead" entry from that project's timeline, so the confirm dialog warns about it. */
  convertedProjectSlug?: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const [typed, setTyped] = useState("");
  const typedToConfirm = typed.trim().toLowerCase() === CONFIRM_WORD;

  function close() {
    setConfirming(false);
    setMessage("");
    setTyped("");
  }

  async function remove() {
    if (!typedToConfirm) return;
    setDeleting(true);
    setMessage("");
    const response = await fetch(`/api/leads/${encodeURIComponent(slug)}`, {
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
      setMessage(result.error ?? "Lead could not be deleted.");
      setDeleting(false);
      return;
    }
    close();
    router.push("/leads");
    router.refresh();
  }

  return (
    <>
      {/* Quiet by default in both variants: a red-outlined button on the lead page read as a
          primary action on a screen the user visits to read, not to delete. */}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`rounded-md border border-border text-muted-foreground hover:border-red-500/60 hover:text-red-300 ${
          compact ? "px-3 py-2 text-xs" : "px-3 py-2 text-sm"
        }`}
      >
        Delete
      </button>
      {confirming && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby={`delete-lead-${slug}`} className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
            <h2 id={`delete-lead-${slug}`} className="font-medium">Delete {name}?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This removes the lead from Mi after confirmation. A recoverable local backup is
              retained; Notion and Dropbox are not changed.
            </p>
            {convertedProjectSlug && (
              <p role="alert" className="mt-2 text-sm text-red-300">
                This lead already converted to project &quot;{convertedProjectSlug}&quot; -- deleting it
                will remove the &quot;converted from lead&quot; entry from that project&apos;s timeline.
              </p>
            )}
            <label htmlFor={`delete-lead-word-${slug}`} className="mt-4 block text-sm text-muted-foreground">
              Type <span className="font-medium text-foreground">{CONFIRM_WORD}</span> to confirm.
            </label>
            <input
              id={`delete-lead-word-${slug}`}
              type="text"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              disabled={deleting}
              onChange={(event) => setTyped(event.target.value)}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            {message && <p role="alert" className="mt-3 text-sm text-red-300">{message}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={close}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting || !typedToConfirm}
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
