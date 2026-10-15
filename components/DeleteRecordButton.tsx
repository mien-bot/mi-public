"use client";

import { useState } from "react";

/**
 * The one delete affordance for every authored record in Mi.
 *
 * Before this existed, records could be created but never removed: a meeting logged against
 * the wrong project, a duplicate deliverable, a decision promoted from a line of notes that
 * turned out not to be a decision — all of them permanent. Each surface growing its own
 * delete button would have meant eight subtly different confirmation flows, so the
 * interaction lives here once and the call sites supply only what differs.
 *
 * Two levels of friction, matching what is actually at stake:
 *
 * - **A single record** gets an inline two-step confirm. A mis-click costs one extra click
 *   to undo, and every server route behind this backs the file up before removing it, so
 *   the record is recoverable from `.mi-backups/` even when the confirm was deliberate.
 * - **A whole folder** — a project, a library collection — asks for its exact name to be
 *   typed back. A slug is easy to mis-click out of a list; a name is not something you type
 *   by accident. That is the same discipline lead deletion has always used.
 *
 * `onDelete` should throw an `Error` whose message is worth showing; it is rendered inline
 * rather than thrown away, because "the schedule changed after you opened it" is exactly
 * the sort of thing the person needs to read.
 */
export function DeleteRecordButton({
  label = "Delete",
  prompt = "Delete this record?",
  recoverableNote = "A recoverable copy is kept on disk.",
  requireTypedName,
  onDelete,
  onDeleted,
  disabled = false,
  className = "",
}: {
  label?: string;
  prompt?: string;
  /** Set to "" to omit the reassurance, e.g. where nothing is backed up. */
  recoverableNote?: string;
  /** When set, the exact text the person must type before Delete is enabled. */
  requireTypedName?: string;
  onDelete: () => Promise<void>;
  /** Called after a successful delete, for call sites that need to close a panel. */
  onDeleted?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const nameMatches = requireTypedName === undefined || typed === requireTypedName;

  function reset() {
    setConfirming(false);
    setTyped("");
    setError("");
  }

  async function run() {
    setBusy(true);
    setError("");
    try {
      await onDelete();
      reset();
      onDeleted?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The record could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        className={`rounded-md border border-border px-3 py-1.5 text-xs text-status-danger-foreground hover:border-status-danger-foreground disabled:opacity-40 ${className}`}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">
        {prompt}
        {recoverableNote ? ` ${recoverableNote}` : ""}
      </span>
      {requireTypedName !== undefined && (
        <input
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={`Type “${requireTypedName}” to confirm`}
          aria-label={`Type ${requireTypedName} to confirm deletion`}
          className="min-w-56 rounded-md border border-border bg-background px-2 py-1 text-xs"
        />
      )}
      <button
        type="button"
        disabled={busy || !nameMatches}
        onClick={() => void run()}
        className="rounded-md bg-status-danger-foreground px-3 py-1.5 text-xs text-background disabled:opacity-40"
      >
        {busy ? "Deleting…" : label}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={reset}
        className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40"
      >
        Keep
      </button>
      {error && <span className="text-status-danger-foreground">{error}</span>}
    </span>
  );
}
