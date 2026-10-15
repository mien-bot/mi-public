"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SectionWithAdd } from "@/components/SectionWithAdd";
import { DeleteRecordButton } from "@/components/DeleteRecordButton";
import type { CommunicationEntry } from "@/lib/schema";

const CHANNELS = ["call", "email", "in-person", "text", "other"];

export function CommunicationLog({ slug, entries }: { slug: string; entries: CommunicationEntry[] }) {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [channel, setChannel] = useState<CommunicationEntry["channel"]>("call");
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();
    if (!summary.trim()) return;
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/leads/${encodeURIComponent(slug)}/correspondence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, channel, summary: summary.trim() }),
    }).catch(() => null);
    if (!response || !response.ok) {
      const data = await response?.json().catch(() => ({})) ?? {};
      setMessage(data.error ?? "Could not save the correspondence entry.");
      setSaving(false);
      return;
    }
    setSummary("");
    setSaving(false);
    close();
    router.refresh();
  }

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  const form = (close: () => void) => (
    <form
      onSubmit={(event) => void submit(event, close)}
      className="grid gap-2 md:grid-cols-[auto_auto_1fr_auto] md:items-end"
    >
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required
          className="rounded-md border border-border bg-card px-2 py-1 text-sm" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Channel</span>
        <select value={channel} onChange={(e) => setChannel(e.target.value as CommunicationEntry["channel"])}
          className="rounded-md border border-border bg-card px-2 py-1 text-sm">
          {CHANNELS.map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Summary</span>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} required
          className="w-full rounded-md border border-border bg-card px-2 py-1 text-sm" />
      </label>
      <button type="submit" disabled={saving} className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50">
        {saving ? "Saving…" : "Add"}
      </button>
    </form>
  );

  /** Removes one logged call/email. Throws so the shared control can surface the reason. */
  async function removeEntry(id: string) {
    const response = await fetch(`/api/leads/${encodeURIComponent(slug)}/correspondence`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "The entry could not be deleted.");
    setMessage("Correspondence entry deleted.");
    router.refresh();
  }

  return (
    <SectionWithAdd
      title="Correspondence"
      description="A lightweight contact log — calls, emails, texts — not a full transcript."
      addLabel="Log correspondence"
      count={sorted.length}
      form={form}
    >
      <ul className="flex flex-col gap-2">
        {sorted.map((entry) => (
          <li key={entry.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium">{entry.date} · {entry.channel}</div>
                <div className="mt-1">{entry.summary}</div>
              </div>
              <DeleteRecordButton
                disabled={saving}
                prompt="Delete this correspondence entry?"
                recoverableNote="The log's previous revision is kept on disk."
                onDelete={() => removeEntry(entry.id)}
              />
            </div>
          </li>
        ))}
        {sorted.length === 0 && <p className="text-sm text-muted-foreground">No correspondence logged yet.</p>}
      </ul>
      {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </SectionWithAdd>
  );
}
