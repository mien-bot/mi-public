"use client";

import { useState } from "react";
import type { ScheduleSnapshotEntry } from "@/types/electron";
import { readJsonResponse } from "@/lib/readJsonResponse";

export function ScheduleRemoveControl({ entries, onRemoved }: {
  entries: ScheduleSnapshotEntry[];
  onRemoved: (id: string) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState("");
  const [reviewed, setReviewed] = useState<ScheduleSnapshotEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const entry = entries.find((item) => item.notion_page_id === selected);
  async function remove() {
    if (!reviewed?.last_edited_time || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/schedule/adjust", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, proposal: {
          id: `remove-${crypto.randomUUID()}`, kind: "schedule-remove", title: `Remove ${reviewed.name}`.slice(0, 160),
          reason: "The person reviewed and confirmed removal from the calendar.",
          data: { eventPageId: reviewed.notion_page_id, name: reviewed.name, expectedLastEditedTime: reviewed.last_edited_time },
        } }),
      });
      const result = await readJsonResponse<{ message: string }>(response, "The event could not be removed.");
      setMessage(result.message);
      const id = reviewed.notion_page_id;
      setReviewed(null);
      setSelected("");
      try { await onRemoved(id); } catch { setMessage(`${result.message} Refresh the calendar to update its view.`); }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The event could not be removed.");
    } finally { setBusy(false); }
  }
  return (
    <details className="mt-4 rounded-lg border border-border bg-background p-3">
      <summary className="cursor-pointer text-sm font-medium">Remove a changed or cancelled event</summary>
      <p className="mt-2 text-xs text-muted-foreground">Choose an event from the synced calendar. Removal moves it to Notion Trash, where it can be restored.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <select aria-label="Event to remove" value={selected} disabled={busy} onChange={(event) => { setSelected(event.target.value); setReviewed(null); setMessage(""); }} className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm">
          <option value="">Choose an event…</option>
          {entries.map((item) => <option key={item.notion_page_id} value={item.notion_page_id}>{item.date?.slice(0, 10) ?? "Undated"} · {item.name}</option>)}
        </select>
        <button type="button" disabled={!entry?.last_edited_time || busy} onClick={() => setReviewed(entry ?? null)} className="rounded-md border border-border px-3 py-2 text-xs disabled:opacity-50">Review removal</button>
      </div>
      {entry && !entry.last_edited_time && <p className="mt-2 text-xs text-muted-foreground">Sync now to load the version needed to review this event.</p>}
      {reviewed && <div className="mt-3 rounded-md border border-red-400/40 bg-red-500/5 p-3">
        <p className="text-sm font-medium">Remove “{reviewed.name}” from Notion and this calendar?</p>
        <p className="mt-1 break-all text-xs text-muted-foreground">{reviewed.date ?? "Undated"} · Notion page {reviewed.notion_page_id}</p>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void remove()} className="rounded-md bg-red-700 px-3 py-2 text-xs text-white disabled:opacity-50">{busy ? "Removing…" : "Confirm removal"}</button>
          <button type="button" disabled={busy} onClick={() => setReviewed(null)} className="rounded-md border border-border px-3 py-2 text-xs">Cancel</button>
        </div>
      </div>}
      {message && <p role="status" className="mt-2 text-xs">{message}</p>}
    </details>
  );
}
