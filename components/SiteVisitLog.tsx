"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SectionWithAdd } from "@/components/SectionWithAdd";
import type { SiteVisitEntry } from "@/lib/schema";

export function SiteVisitLog({ slug, visits }: { slug: string; visits: SiteVisitEntry[] }) {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [attendees, setAttendees] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SiteVisitEntry | null>(null);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/leads/${encodeURIComponent(slug)}/site-visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        attendees: attendees.split(",").map((a) => a.trim()).filter(Boolean),
        notes: notes.trim(),
      }),
    }).catch(() => null);
    if (!response || !response.ok) {
      const data = await response?.json().catch(() => ({})) ?? {};
      setMessage(data.error ?? "Could not save the site visit.");
      setSaving(false);
      return;
    }
    setAttendees("");
    setNotes("");
    setSaving(false);
    close();
    router.refresh();
  }

  async function deleteVisit(visit: SiteVisitEntry) {
    setDeletingId(visit.id);
    setMessage("");
    const response = await fetch(`/api/leads/${encodeURIComponent(slug)}/site-visits`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: visit.id,
        confirmed: true,
        expectedDate: visit.date,
      }),
    }).catch(() => null);
    if (!response || !response.ok) {
      const data = await response?.json().catch(() => ({})) ?? {};
      setMessage(data.error ?? "Could not delete the site visit.");
      setDeletingId(null);
      return;
    }
    setPendingDelete(null);
    setDeletingId(null);
    setMessage("Site visit deleted. Mi kept a recoverable backup of the previous visit index.");
    router.refresh();
  }

  const sorted = [...visits].sort((a, b) => b.date.localeCompare(a.date));

  const form = (close: () => void) => (
    <form onSubmit={(event) => void submit(event, close)} className="grid gap-2 md:grid-cols-[auto_1fr_auto] md:items-end">
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required
          className="rounded-md border border-border bg-card px-2 py-1 text-sm" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Attendees (comma-separated)</span>
        <input value={attendees} onChange={(e) => setAttendees(e.target.value)}
          className="w-full rounded-md border border-border bg-card px-2 py-1 text-sm" />
      </label>
      <button type="submit" disabled={saving} className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50">
        {saving ? "Saving…" : "Add visit"}
      </button>
      <label className="text-sm md:col-span-3">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          className="w-full rounded-md border border-border bg-card px-2 py-1 text-sm" />
      </label>
    </form>
  );

  return (
    <SectionWithAdd
      title="Site visits"
      description="Dated visits with who attended and what was observed."
      addLabel="Add site visit"
      count={sorted.length}
      form={form}
    >
      <ul className="flex flex-col gap-2">
        {sorted.map((visit) => (
          <li key={visit.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium">{visit.date}</div>
              <button
                type="button"
                onClick={() => setPendingDelete(visit)}
                disabled={deletingId !== null}
                className="shrink-0 text-xs text-status-danger-foreground hover:underline disabled:opacity-50"
              >
                Delete
              </button>
            </div>
            {visit.attendees.length > 0 && (
              <div className="text-muted-foreground">Attendees: {visit.attendees.join(", ")}</div>
            )}
            {visit.notes && <div className="mt-1">{visit.notes}</div>}
          </li>
        ))}
        {sorted.length === 0 && <p className="text-sm text-muted-foreground">No site visits logged yet.</p>}
      </ul>
      {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
      {pendingDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-site-visit-title"
            className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-lg"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-status-danger-foreground">Confirm deletion</p>
            <h2 id="delete-site-visit-title" className="mt-1 font-medium">Delete the {pendingDelete.date} site visit?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This removes only this site-visit entry. Mi will keep a recoverable backup of the previous index.
            </p>
            <dl className="mt-4 space-y-2 rounded-md border border-border p-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Attendees</dt><dd>{pendingDelete.attendees.join(", ") || "None recorded"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap">{pendingDelete.notes || "No notes recorded"}</dd></div>
            </dl>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deletingId !== null}
                className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteVisit(pendingDelete)}
                disabled={deletingId !== null}
                className="rounded-md bg-status-danger px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {deletingId === pendingDelete.id ? "Deleting…" : "Delete site visit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SectionWithAdd>
  );
}
