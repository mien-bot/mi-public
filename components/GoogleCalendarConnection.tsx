"use client";

import { useEffect, useState } from "react";
import type { GoogleCalendarStatus } from "@/types/electron";

const control = "w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm";

/** Connects one Google calendar for reading. Secrets go straight to the desktop process. */
export function GoogleCalendarConnection() {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([]);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void window.electronAPI?.googleCalendar?.status().then(setStatus).catch(() => {});
  }, []);
  const api = typeof window === "undefined" ? undefined : window.electronAPI?.googleCalendar;
  if (!api || !status) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Google Calendar could not be updated."); }
    finally { setBusy(false); }
  }
  const button = "rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50";

  return <section aria-label="Google Calendar" className="mt-5 rounded-md border border-border p-4">
    <h3 className="font-medium">Google Calendar</h3>
    <p className="mt-1 text-sm text-muted-foreground">Shows one Google calendar on the Studio calendar. Mi can only read it, and never changes Google.</p>
    {!status.hasClient && <div className="mt-3 space-y-2">
      <p className="text-sm text-muted-foreground">Needs a Google Cloud OAuth client (Desktop app type) with the Calendar API turned on. Whoever manages STUDIO’s Google account creates it once.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">Client ID<input value={clientId} onChange={(event) => setClientId(event.target.value)} className={`mt-1 block ${control} text-foreground`} /></label>
        <label className="text-xs text-muted-foreground">Client secret<input type="password" value={clientSecret} autoComplete="off" onChange={(event) => setClientSecret(event.target.value)} className={`mt-1 block ${control} text-foreground`} /></label>
      </div>
      <button type="button" className={button} disabled={busy || !clientId.trim()} onClick={() => void run(async () => {
        setStatus(await api.setClient(clientId, clientSecret)); setClientSecret("");
      })}>Save client</button>
    </div>}
    {status.hasClient && !status.connected && <button type="button" className={`${button} mt-3`} disabled={busy} onClick={() => void run(async () => {
      setMessage("Finish signing in with the STUDIO account in your browser.");
      setStatus(await api.connect()); setCalendars(await api.calendars()); setMessage("");
    })}>{busy ? "Waiting for Google…" : "Connect Google Calendar"}</button>}
    {status.connected && <div className="mt-3 space-y-2 text-sm">
      <p>{status.calendarName ? `Showing ${status.calendarName}.` : "Connected. Choose a calendar to show."}</p>
      {calendars.length > 0 && <select aria-label="Google calendar" value={status.calendarId ?? ""} disabled={busy} onChange={(event) => void run(async () => setStatus(await api.select(event.target.value)))} className={`${control} max-w-md`}>
        <option value="" disabled>Choose a calendar</option>
        {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
      </select>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => void run(async () => setCalendars(await api.calendars()))}>{status.calendarId ? "Change calendar" : "Load calendars"}</button>
        <button type="button" className={button} disabled={busy} onClick={() => void run(async () => { setStatus(await api.disconnect()); setCalendars([]); })}>Disconnect</button>
      </div>
    </div>}
    {message && <p role="status" className="mt-2 text-sm text-muted-foreground">{message}</p>}
  </section>;
}
