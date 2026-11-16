"use client";

import type { ScheduleType } from "@/lib/schema";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScheduleAdjustAgent } from "@/components/ScheduleAdjustAgent";
import { MonthScheduleView, TimedScheduleView } from "@/components/ScheduleCalendarViews";
import { ScheduleCreateForm } from "@/components/ScheduleCreateForm";
import { ScheduleRemoveControl } from "@/components/ScheduleRemoveControl";
import { ActivityIndicator } from "@/components/UiState";
import {
  applyOptimisticScheduleReschedule,
  buildDragDuplicateProposal,
  buildDragRescheduleProposal,
  GOOGLE_ENTRY_PREFIX,
  moveScheduleAnchor,
  scheduleDateKey,
  scheduleViewHeading,
  scheduleVisibleDays,
  type ScheduleCalendarView,
  type ScheduleDragMode,
  dateFromScheduleKey,
} from "@/components/scheduleCalendarModel";
import { readJsonResponse } from "@/lib/readJsonResponse";
import { compareTier, scheduleEntryTier, slipWarnings, type TimelineRow } from "@/lib/scheduleInsights";
import type { GoogleCalendarEvent, ScheduleSnapshot, ScheduleSnapshotEntry } from "@/types/electron";
import { usePersonalTimezone } from "./usePersonalTimezone";
import { StatusNotice } from "./UiState";
import { TierLegend, UpcomingCriticalStrip, YearTimelineView } from "./YearTimelineView";
import { YearMonthsView } from "./YearMonthsView";
import { CalendarKindFilter, CalendarShortcuts, useHiddenKinds } from "./CalendarParts";
import { entryKind, ScheduleEntryPeek } from "./ScheduleEntryPeek";
import { useCalendarKeys } from "./useCalendarKeys";

type PendingDrop = { entry: ScheduleSnapshotEntry; mode: ScheduleDragMode; newDate: string; targetMinutes?: number };

/** Notion "Date" values may be date-only or a full timestamp -- always group by the date portion. */
function entryDateKey(entry: ScheduleSnapshotEntry): string | null {
  return entry.date ? entry.date.slice(0, 10) : null;
}

export function StudioScheduleCalendar() {
  const { timezone } = usePersonalTimezone();
  const [mounted, setMounted] = useState(false);
  const [snapshot, setSnapshot] = useState<ScheduleSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [eventDraftDate, setEventDraftDate] = useState<string | null>(null);
  const [eventDraftTime, setEventDraftTime] = useState("");
  const [peek, setPeek] = useState<ScheduleSnapshotEntry | null>(null);
  const { hiddenKinds, toggleKind } = useHiddenKinds();
  const root = useRef<HTMLElement>(null);
  const [view, setView] = useState<ScheduleCalendarView>("month");
  const [dragging, setDragging] = useState<{ entry: ScheduleSnapshotEntry; mode: ScheduleDragMode } | null>(null);
  const [savingEntryId, setSavingEntryId] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [portfolio, setPortfolio] = useState<TimelineRow[]>([]);
  const [portfolioGaps, setPortfolioGaps] = useState<string[]>([]);
  const today = new Date();
  const [anchor, setAnchor] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const eventFormRef = useRef<HTMLDivElement>(null);
  const portfolioYear = anchor.getFullYear();
  const [googleName, setGoogleName] = useState<string | null>(null);
  const [showGoogle, setShowGoogle] = useState(true);
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const googleEntries = useMemo<ScheduleSnapshotEntry[]>(() => googleEvents.map((event) => ({
    notion_page_id: `${GOOGLE_ENTRY_PREFIX}${event.id}`, name: event.name, date: event.date, date_end: event.date_end,
    start_time: null, end_time: null, last_edited_time: null, type: [], status: null, hours: null, attendees: [], project_page_ids: [],
  })), [googleEvents]);

  useEffect(() => {
    const api = window.electronAPI?.googleCalendar;
    if (!mounted || !api) return;
    let live = true;
    api.status().then(async (status) => {
      if (!status.connected || !status.calendarId) return;
      const events = await api.events(`${portfolioYear}-01-01`, `${portfolioYear}-12-31`);
      if (live) { setGoogleName(status.calendarName); setGoogleEvents(events); }
    }).catch(() => { if (live) setMessage("Mi could not read Google Calendar. Check Settings › Connections."); });
    return () => { live = false; };
  }, [mounted, portfolioYear]);

  useEffect(() => {
    if (!mounted) return;
    let live = true;
    fetch(`/api/schedule/portfolio?year=${portfolioYear}`)
      .then((response) => readJsonResponse<{ rows: TimelineRow[]; unavailable: string[] }>(response, "Mi could not load project timelines."))
      .then((data) => { if (live) { setPortfolio(data.rows); setPortfolioGaps(data.unavailable); } })
      .catch((error) => { if (live) setMessage(error instanceof Error ? error.message : "Mi could not load project timelines."); });
    return () => { live = false; };
  }, [mounted, portfolioYear, snapshot]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Electron preload exists only after hydration
    setMounted(true);
  }, []);

  const refetch = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      const cached = await window.electronAPI.schedule.getSnapshot();
      if (cached && cached.schema_version < 3) {
        setSnapshot(await window.electronAPI.notionSync.runNow() ?? cached);
      } else {
        setSnapshot(cached);
      }
    } catch {
      setMessage("Mi could not load the cached STUDIO Schedule.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Electron IPC snapshot load begins only after preload hydration
    if (mounted) void refetch();
  }, [mounted, refetch]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, ScheduleSnapshotEntry[]>();
    for (const entry of [...(snapshot?.entries ?? []), ...(showGoogle ? googleEntries : [])]) {
      const key = entryDateKey(entry);
      if (!key || hiddenKinds.includes(entry.notion_page_id.startsWith(GOOGLE_ENTRY_PREFIX) ? "meeting" : entryKind(entry))) continue;
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    for (const entries of map.values()) entries.sort((a, b) => compareTier(scheduleEntryTier(a.type), scheduleEntryTier(b.type)));
    return map;
  }, [snapshot, googleEntries, showGoogle, hiddenKinds]);

  /** Project rows plus Notion deadlines no project tracks, so the year view hides nothing critical. */
  const yearRows = useMemo(() => {
    const tracked = new Set(portfolio.flatMap((row) => row.markers.map((marker) => marker.notionEventId)));
    const markers = (snapshot?.entries ?? [])
      .filter((entry) => entry.date && !tracked.has(entry.notion_page_id) && ["critical", "high"].includes(scheduleEntryTier(entry.type)))
      .map((entry) => ({ id: entry.notion_page_id, date: entry.date!.slice(0, 10), name: entry.name, tier: scheduleEntryTier(entry.type),
        kind: "milestone" as const, done: entry.status === "Done", notionEventId: entry.notion_page_id }));
    if (!markers.length) return portfolio;
    return [...portfolio, { slug: "", name: "Other Notion deadlines", phases: [], markers, contractEnd: "",
      details: { phases: [], payments: [], contract_end_date: "" } } satisfies TimelineRow];
  }, [portfolio, snapshot]);

  const days = useMemo(() => scheduleVisibleDays(anchor, view), [anchor, view]);

  const visibleWindow = days.length > 0 ? { from: scheduleDateKey(days[0]), to: scheduleDateKey(days[days.length - 1]) } : null;
  const outsideSnapshotWindow = Boolean(snapshot && visibleWindow && (
    visibleWindow.from < snapshot.window.from || visibleWindow.to > snapshot.window.to
  ));
  const snapshotAgeMs = snapshot ? today.getTime() - Date.parse(snapshot.generated_at) : 0;
  const snapshotIsStale = Boolean(snapshot && (!Number.isFinite(snapshotAgeMs) || snapshotAgeMs > 8 * 60 * 60 * 1000));

  function changeRange(offset: -1 | 1) {
    setAnchor((current) => moveScheduleAnchor(current, view, offset));
  }

  const todayKey = scheduleDateKey(today);
  const initialEventDate = view === "month" && anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth()
    ? todayKey
    : scheduleDateKey(anchor);
  const navigationUnit = view === "year" ? "year" : view === "month" ? "month" : view === "day" ? "day" : "week";
  const pendingWarnings = pendingDrop && pendingDrop.mode === "move"
    ? slipWarnings(
        portfolio.find((row) => row.markers.some((marker) => marker.notionEventId === pendingDrop.entry.notion_page_id))?.details ?? null,
        pendingDrop.entry.date?.slice(0, 10) ?? pendingDrop.newDate,
        pendingDrop.newDate,
      )
    : [];

  function openEventForm(date: string, startTime = "") {
    setEventDraftTime(startTime);
    setEventDraftDate(date);
    window.requestAnimationFrame(() => {
      eventFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  const { helpOpen, setHelpOpen } = useCalendarKeys(root, {
    add: () => openEventForm(initialEventDate),
    today: () => { const now = new Date(); setAnchor(new Date(now.getFullYear(), now.getMonth(), now.getDate())); },
    move: changeRange,
    view: setView,
  });

  async function syncNow() {
    if (!window.electronAPI) return false;
    setSyncing(true);
    setMessage("");
    try {
      const next = await window.electronAPI.notionSync.runNow();
      if (next) {
        setSnapshot(next);
        return true;
      } else {
        setMessage("Sync ran, but no STUDIO Schedule snapshot is available yet — check Settings › Connections.");
        return false;
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sync failed.");
      return false;
    } finally {
      setSyncing(false);
    }
  }

  function openInNotion(entry: ScheduleSnapshotEntry) {
    if (entry.notion_page_id.startsWith(GOOGLE_ENTRY_PREFIX)) {
      const url = googleEvents.find((event) => `${GOOGLE_ENTRY_PREFIX}${event.id}` === entry.notion_page_id)?.url;
      if (url) void window.electronAPI?.terminal.openLink(url).catch(() => setMessage("Mi could not open that Google Calendar event."));
      return;
    }
    window.electronAPI?.notion.open(entry.notion_page_id).catch(() => {
      setMessage("Mi could not open that page in Notion.");
    });
  }

  /** Pressing Save on the card is the confirmation for this one row. */
  async function saveEntryCategory(entry: ScheduleSnapshotEntry, type: ScheduleType) {
    const response = await fetch("/api/schedule/entry-type", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventPageId: entry.notion_page_id, type, confirmed: true }),
    });
    const data = await readJsonResponse<{ note?: string | null }>(response, "Notion could not be updated.");
    setSnapshot((current) => current ? {
      ...current,
      entries: current.entries.map((item) => item.notion_page_id === entry.notion_page_id ? { ...item, type: [type] } : item),
    } : current);
    setPeek(null);
    setMessage(data.note ?? `${entry.name} is now ${type}.`);
    await syncNow();
  }

  function openDay(date: string) {
    setAnchor(dateFromScheduleKey(date));
    setView("day");
  }

  /** A drop only proposes the change: nothing reaches Notion until it is confirmed below. */
  function applyDrop(newDate: string, targetMinutes?: number) {
    if (!dragging) return;
    if (savingEntryId) {
      setDragging(null);
      setMessage("Wait for the current calendar change to finish syncing.");
      return;
    }
    setPendingDrop({ ...dragging, newDate, targetMinutes });
    setDragging(null);
  }

  async function confirmDrop(drop: PendingDrop) {
    const { entry, mode, newDate, targetMinutes } = drop;
    setPendingDrop(null);
    const previousSnapshot = snapshot;
    try {
      if (mode === "duplicate") {
        const proposal = buildDragDuplicateProposal(entry, newDate, crypto.randomUUID(), { targetMinutes, timezone });
        setDragging(null);
        if (!proposal || proposal.kind !== "schedule-duplicate") return;
        setSavingEntryId(proposal.data.eventPageId);
        setMessage(`Duplicating "${proposal.data.name}" in Notion…`);
        const response = await fetch("/api/schedule/adjust", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposal, confirmed: true }),
        });
        const body = await readJsonResponse<{ message?: string }>(response, "The event could not be duplicated.");
        const synced = await syncNow();
        setMessage(`${body.message ?? "Event duplicated."}${synced ? " Calendar synced." : " Use Sync now to refresh."}`);
        return;
      }
      const proposal = buildDragRescheduleProposal(entry, newDate, crypto.randomUUID(), {
        mode,
        targetMinutes,
        timezone,
      });
      setDragging(null);
      if (!proposal || proposal.kind !== "schedule-reschedule") return;
      setSavingEntryId(proposal.data.eventPageId);
      setMessage(`Saving "${proposal.data.name}" to Notion…`);
      setSnapshot((current) => applyOptimisticScheduleReschedule(current, proposal));

      const response = await fetch("/api/schedule/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal, confirmed: true }),
      });
      const body = await readJsonResponse<{ message?: string }>(response, "The dragged event could not be moved.");

      try {
        const refreshed = await window.electronAPI?.notionSync.runNow();
        if (refreshed) {
          setSnapshot(refreshed);
          setMessage(`${body.message ?? "Event updated."} Calendar synced.`);
        } else {
          setMessage(`${body.message ?? "Event updated."} The calendar refresh is unavailable; use Sync now to retry.`);
        }
      } catch {
        setMessage(`${body.message ?? "Event updated."} Mi could not refresh the calendar; use Sync now to retry.`);
      }
    } catch (error) {
      setSnapshot(previousSnapshot);
      setMessage(error instanceof Error ? error.message : "That event cannot be moved safely.");
    } finally {
      setDragging(null);
      setSavingEntryId(null);
    }
  }

  function beginDrag(entry: ScheduleSnapshotEntry, mode: ScheduleDragMode) {
    if (savingEntryId) return;
    setDragging({ entry, mode });
  }

  if (!mounted) return null;

  if (!window.electronAPI) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
        The STUDIO Schedule calendar is available in the Mi desktop app.
      </section>
    );
  }

  return (
    <section ref={root} className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-light">STUDIO Schedule</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {snapshot
              ? `Last synced ${new Date(snapshot.generated_at).toLocaleString()}`
              : loading
                ? "Loading…"
                : "Not synced yet."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => eventDraftDate ? setEventDraftDate(null) : openEventForm(initialEventDate)}
            aria-expanded={Boolean(eventDraftDate)}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground"
          >
            {eventDraftDate ? "Hide event form" : "+ Add event"}
          </button>
          <button type="button" onClick={() => changeRange(-1)} aria-label={`Previous ${navigationUnit}`} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent">&larr; Previous {navigationUnit}</button>
          <button type="button" onClick={() => setAnchor(new Date(today.getFullYear(), today.getMonth(), today.getDate()))} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent">Today</button>
          <button type="button" onClick={() => changeRange(1)} aria-label={`Next ${navigationUnit}`} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent">Next {navigationUnit} &rarr;</button>
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={syncing || Boolean(savingEntryId)}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
          >
            {syncing ? <ActivityIndicator label="Syncing Notion…" /> : "Sync now"}
          </button>
        </div>
      </div>
      {eventDraftDate && (
        <div ref={eventFormRef}>
          <ScheduleCreateForm
            key={`${eventDraftDate}-${eventDraftTime}`}
            initialDate={eventDraftDate}
            initialStartTime={eventDraftTime}
            onCancel={() => setEventDraftDate(null)}
            onApplied={syncNow}
          />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Press C or click a day to add. Drag to move, Ctrl-drag to copy, drag a bottom edge to resize. Press ? for shortcuts.</p>
        <div className="inline-flex rounded-md border border-border p-1" aria-label="Calendar view">
          {(["year", "month", "week", "work-week", "day"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={`rounded px-2.5 py-1.5 text-xs capitalize ${view === option ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
            >
              {option === "work-week" ? "Work week" : option}
            </button>
          ))}
        </div>
      </div>
      <UpcomingCriticalStrip rows={yearRows} today={todayKey} />
      {pendingDrop && <div role="alertdialog" aria-label="Confirm calendar change" onKeyDown={(event) => { if (event.key === "Escape") setPendingDrop(null); }} className="fixed bottom-4 left-1/2 z-[75] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-accent/50 bg-card p-3 text-sm shadow-xl">
        <p className="font-medium">{pendingDrop.mode === "duplicate" ? "Duplicate" : pendingDrop.mode === "resize" ? "Change the time of" : "Move"} “{pendingDrop.entry.name}”{pendingDrop.mode === "resize" ? "" : ` to ${pendingDrop.newDate}`}?</p>
        {pendingWarnings.map((warning) => <p key={warning} className="mt-1 text-status-warning-foreground">{warning}</p>)}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={() => setPendingDrop(null)} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
          <button type="button" autoFocus onClick={() => void confirmDrop(pendingDrop)} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground">Save to Notion</button>
        </div>
      </div>}
      <h3 className="mt-3 text-center font-medium">{scheduleViewHeading(anchor, view)}</h3>
      {portfolioGaps.length > 0 && <p className="mt-1 text-center text-xs text-status-warning-foreground">Couldn’t read: {portfolioGaps.join(", ")}</p>}
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-muted-foreground" />Personal / internal</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-accent" />Project-linked · stable color per project</span>
        {googleName && <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={showGoogle} onChange={(event) => setShowGoogle(event.target.checked)} />Google: {googleName} (read-only)</label>}
      </div>
      {(outsideSnapshotWindow || snapshotIsStale) && (
        <StatusNotice tone="warning" title="Refresh recommended" className="mt-2">
          {outsideSnapshotWindow
            ? `This view extends beyond Mi’s cached ${snapshot?.window.from} to ${snapshot?.window.to} schedule window, so blank dates may not be empty in Notion. Sync now before relying on them.`
            : "This schedule snapshot is more than 8 hours old. Sync now before making planning decisions."}
        </StatusNotice>
      )}
      <CalendarKindFilter hiddenKinds={hiddenKinds} onToggle={toggleKind} />
      {view === "year" ? <>
        <TierLegend />
        <YearMonthsView
          year={anchor.getFullYear()}
          today={todayKey}
          markers={yearRows.flatMap((row) => row.markers.map(({ date, tier, done, name }) => ({ date, tier, done, name: `${name} · ${row.name}` })))}
          onSelectDay={openDay}
        />
        <h3 className="mt-6 text-xs font-medium text-muted-foreground">Project timelines</h3>
        <YearTimelineView rows={yearRows} year={anchor.getFullYear()} today={todayKey} />
      </> : view === "month" ? (
        <MonthScheduleView
          days={days}
          anchor={anchor}
          todayKey={todayKey}
          entriesByDate={entriesByDate}
          onOpen={setPeek}
          onDragStart={beginDrag}
          onDragEnd={() => setDragging(null)}
          onDrop={(date) => applyDrop(date)}
          onCreate={openEventForm}
          onOpenDay={openDay}
          timezone={timezone}
          savingEntryId={savingEntryId}
        />
      ) : (
        <TimedScheduleView
          view={view}
          days={days}
          todayKey={todayKey}
          entriesByDate={entriesByDate}
          onOpen={setPeek}
          onDragStart={beginDrag}
          onDragEnd={() => setDragging(null)}
          onDrop={(date, minutes) => applyDrop(date, minutes)}
          onCreate={openEventForm}
          timezone={timezone}
          savingEntryId={savingEntryId}
          dragging={dragging}
        />
      )}
      {message && <p role="status" className="mt-3 text-xs text-muted-foreground">{message}</p>}
      {peek && <ScheduleEntryPeek
        entry={peek}
        sourceLabel={peek.notion_page_id.startsWith(GOOGLE_ENTRY_PREFIX) ? "Google Calendar" : "Notion"}
        onOpenSource={() => { openInNotion(peek); setPeek(null); }}
        onClose={() => setPeek(null)}
        onSaveCategory={peek.notion_page_id.startsWith(GOOGLE_ENTRY_PREFIX) ? undefined : (type) => saveEntryCategory(peek, type)}
      />}
      {helpOpen && <CalendarShortcuts onClose={() => setHelpOpen(false)} />}

      <div className="mt-5 border-t border-border pt-4">
        <ScheduleRemoveControl entries={snapshot?.entries ?? []} onRemoved={async (id) => {
          setSnapshot((current) => current ? { ...current, entries: current.entries.filter((entry) => entry.notion_page_id !== id) } : current);
          await syncNow();
        }} />
        <ScheduleAdjustAgent onApplied={syncNow} />
      </div>
    </section>
  );
}
