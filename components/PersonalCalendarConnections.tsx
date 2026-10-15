"use client";

import { useEffect, useRef, useState } from "react";
import type { PersonalCalendarOption, PersonalCalendarStatus } from "@/types/electron";

const emptyStatus: PersonalCalendarStatus = {
  hasToken: false,
  dataSourceId: null,
  name: null,
  titleProperty: null,
  dateProperty: null,
};

export function PersonalCalendarConnections({
  onStatusChange,
}: {
  onStatusChange?: (status: PersonalCalendarStatus) => void;
}) {
  const tokenInput = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<PersonalCalendarStatus>(emptyStatus);
  const [calendars, setCalendars] = useState<PersonalCalendarOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [titleProperty, setTitleProperty] = useState("");
  const [dateProperty, setDateProperty] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  function publish(next: PersonalCalendarStatus) {
    setStatus(next);
    onStatusChange?.(next);
  }

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Electron preload exists only after hydration
    setMounted(true);
    const api = window.electronAPI?.personalCalendar;
    if (!api) return;
    void api.status().then((next) => {
      if (!cancelled) publish(next);
    }).catch(() => {
      if (!cancelled) setMessage("Mi could not read the personal calendar connection.");
    });
    return () => { cancelled = true; };
    // onStatusChange is intentionally a notification callback, not a reason to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = calendars.find((calendar) => calendar.id === selectedId) ?? null;

  function chooseCalendar(id: string) {
    setSelectedId(id);
    const calendar = calendars.find((candidate) => candidate.id === id);
    setTitleProperty(calendar?.titleProperties[0] ?? "");
    setDateProperty(calendar?.dateProperties[0] ?? "");
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The personal calendar action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function discover() {
    const api = window.electronAPI?.personalCalendar;
    if (!api) throw new Error("Personal calendar connections are available in the Mi desktop app.");
    const found = await api.discover();
    setCalendars(found);
    const preferred = found.find((calendar) => calendar.id === status.dataSourceId)
      ?? found.find((calendar) => calendar.compatible)
      ?? found[0];
    chooseCalendar(preferred?.id ?? "");
    setMessage(found.length
      ? `Found ${found.length} calendar${found.length === 1 ? "" : "s"}. Select the exact destination below.`
      : "No Notion data sources are shared with this personal integration.");
  }

  if (!mounted || !window.electronAPI?.personalCalendar) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-card p-5">
        <h2 className="font-display text-xl font-light">Calendar connections</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Personal Notion credentials and calendar selection are available in the Mi desktop app.
          STUDIO sharing continues to use the firm connection configured in Settings.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">Destinations</p>
          <h2 className="mt-1 font-display text-xl font-light">Calendar connections</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            STUDIO uses Mi&apos;s firm connection. Your personal calendar uses a separate encrypted
            token and only the exact calendar you select here.
          </p>
        </div>
        <div className="grid gap-1 text-right text-xs">
          <span className="font-medium text-foreground">STUDIO Schedule · configured in Settings</span>
          <span className={status.name ? "text-accent" : "text-muted-foreground"}>
            Personal calendar · {status.name || (status.hasToken ? "calendar not selected" : "not connected")}
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-background p-4">
        <label className="text-sm font-medium">
          Personal Notion integration token
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Enter it here—not in chat. Mi encrypts it with this computer&apos;s operating-system credential protection.
          </span>
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            ref={tokenInput}
            type="password"
            autoComplete="off"
            placeholder={status.hasToken ? "Stored securely — enter to replace" : "Enter personal integration token"}
            className="min-w-64 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => {
              const token = tokenInput.current?.value || "";
              if (!token.trim()) throw new Error("Enter a personal Notion integration token.");
              await window.electronAPI!.personalCalendar.setToken(token);
              if (tokenInput.current) tokenInput.current.value = "";
              publish(await window.electronAPI!.personalCalendar.status());
              setCalendars([]);
              setMessage("Personal Notion credential stored securely. Find calendars to choose its destination.");
            })}
            className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50"
          >
            {status.hasToken ? "Replace token" : "Store token"}
          </button>
          {status.hasToken && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmClear(true)}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:border-red-400/60 hover:text-red-600"
            >
              Clear connection
            </button>
          )}
        </div>
      </div>

      {confirmClear && (
        <div className="mt-3 rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm">
          <p className="font-medium">Clear the personal calendar connection?</p>
          <p className="mt-1 text-xs text-muted-foreground">This removes the encrypted token and saved calendar selection. Existing Notion items are not changed.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              await window.electronAPI!.personalCalendar.clearToken();
              publish(emptyStatus);
              setCalendars([]);
              setConfirmClear(false);
              setMessage("Personal calendar connection cleared.");
            })} className="rounded-md bg-red-600 px-3 py-2 text-xs text-white disabled:opacity-50">Confirm clear</button>
            <button type="button" onClick={() => setConfirmClear(false)} className="rounded-md border border-border px-3 py-2 text-xs">Keep connection</button>
          </div>
        </div>
      )}

      {status.hasToken && (
        <div className="mt-4 rounded-lg border border-border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Choose the exact personal calendar</p>
              <p className="mt-1 text-xs text-muted-foreground">Only data sources shared with this integration are listed. Mi never guesses a calendar ID.</p>
            </div>
            <button type="button" disabled={busy} onClick={() => void run(discover)} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50">
              {busy ? "Checking…" : "Find calendars"}
            </button>
          </div>
          {calendars.length > 0 && (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="text-xs font-medium text-muted-foreground">
                Calendar
                <select value={selectedId} onChange={(event) => chooseCalendar(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
                  {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}{calendar.compatible ? "" : " — needs date field"}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Title field
                <select value={titleProperty} onChange={(event) => setTitleProperty(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
                  {(selected?.titleProperties ?? []).map((name) => <option key={name}>{name}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Date field
                <select value={dateProperty} onChange={(event) => setDateProperty(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
                  {(selected?.dateProperties ?? []).map((name) => <option key={name}>{name}</option>)}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !selectedId || !titleProperty || !dateProperty}
                onClick={() => void run(async () => {
                  const next = await window.electronAPI!.personalCalendar.select({ dataSourceId: selectedId, titleProperty, dateProperty });
                  publish(next);
                  setMessage(`Personal calendar set to ${next.name}.`);
                })}
                className="rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground disabled:opacity-50 md:col-span-3 md:justify-self-start"
              >
                Confirm this calendar
              </button>
            </div>
          )}
        </div>
      )}
      {message && <p role="status" className="mt-3 text-xs text-muted-foreground">{message}</p>}
    </section>
  );
}
