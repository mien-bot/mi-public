"use client";

import { useState } from "react";
import type { ElectronGoogleCalendarAPI, GooglePushPreview, GooglePushResult, GoogleCalendarStatus } from "@/types/electron";

const button = "rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50";

function formatWhen(value: string): string {
  const timed = value.includes("T");
  const parsed = new Date(timed ? value : `${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, timed
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" }).format(parsed);
}

function Group({ title, items }: { title: string; items: GooglePushPreview["adds"] }) {
  if (items.length === 0) return null;
  return <div>
    <p className="text-xs font-medium">{title} ({items.length})</p>
    <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-sm text-muted-foreground">
      {items.map((item, index) => <li key={`${item.name}-${index}`} className="flex justify-between gap-3">
        <span className="min-w-0 truncate">{item.name}</span>
        <span className="shrink-0 text-xs">{formatWhen(item.when)}</span>
      </li>)}
    </ul>
  </div>;
}

/** Nothing reaches Google until the exact plan on screen is confirmed. */
export function GoogleCalendarSend({ api, status, onStatus }: {
  api: ElectronGoogleCalendarAPI;
  status: GoogleCalendarStatus;
  onStatus: (status: GoogleCalendarStatus) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<GooglePushPreview | null>(null);
  const [results, setResults] = useState<GooglePushResult[]>([]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Google Calendar could not be updated."); }
    finally { setBusy(false); }
  }

  function loadPreview(mode: "send" | "remove") {
    void run(async () => { setResults([]); setPreview(await api.previewPush(mode)); });
  }

  if (!status.canSend) {
    return <div className="rounded-md border border-border p-3">
      <p className="text-sm text-muted-foreground">Mi only reads this calendar now. Allow sending to add STUDIO Schedule milestones and meetings to it. Each send is previewed first.</p>
      <button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => void run(async () => {
        setMessage("Finish signing in with the STUDIO account in your browser.");
        onStatus(await api.connect(true));
        setMessage("");
      })}>{busy ? "Waiting for Google…" : "Allow sending"}</button>
      {message && <p role="status" className="mt-2 text-sm text-muted-foreground">{message}</p>}
    </div>;
  }

  const changes = preview ? preview.adds.length + preview.updates.length + preview.removals.length : 0;
  const failed = results.filter((result) => result.status === "failed");
  return <div className="space-y-2 rounded-md border border-border p-3">
    <p className="text-sm text-muted-foreground">Sends project milestones and meetings to {status.calendarName}. Work sessions, personal items and past dates stay out, nobody gets an invitation, and Mi only ever changes events it added.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy} onClick={() => loadPreview("send")}>{busy && !preview ? "Checking…" : "Preview send"}</button>
      <button type="button" className={button} disabled={busy} onClick={() => loadPreview("remove")}>Remove everything Mi added</button>
    </div>
    {preview && <div className="space-y-2 rounded-md bg-muted/40 p-3" aria-label="Google Calendar changes">
      {changes === 0
        ? <p className="text-sm">{preview.mode === "remove" ? "Mi has nothing on this calendar." : `${preview.calendarName} is up to date.`}</p>
        : <>
          <Group title="Add" items={preview.adds} />
          <Group title="Update" items={preview.updates} />
          <Group title="Remove" items={preview.removals} />
        </>}
      <div className="flex justify-end gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => setPreview(null)}>{changes ? "Cancel" : "Close"}</button>
        {changes > 0 && <button type="button" disabled={busy} onClick={() => void run(async () => {
          const applied = await api.applyPush(preview.mode, preview.fingerprint);
          setResults(applied);
          setPreview(null);
          const done = applied.filter((result) => result.status === "done").length;
          setMessage(`${done} of ${applied.length} ${applied.length === 1 ? "change" : "changes"} made in ${preview.calendarName}.`);
        })} className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50">{busy ? "Sending…" : `Confirm ${changes} ${changes === 1 ? "change" : "changes"}`}</button>}
      </div>
    </div>}
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {failed.length > 0 && <ul role="alert" className="space-y-1 text-sm text-status-danger-foreground">
      {failed.map((result, index) => <li key={`${result.name}-${index}`}>{result.name}: {result.error}</li>)}
    </ul>}
  </div>;
}
