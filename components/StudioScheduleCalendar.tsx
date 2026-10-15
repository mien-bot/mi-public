"use client";

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
  moveScheduleAnchor,
  scheduleDateKey,
  scheduleViewHeading,
  scheduleVisibleDays,
  type ScheduleCalendarView,
  type ScheduleDragMode,
} from "@/components/scheduleCalendarModel";
import { readJsonResponse } from "@/lib/readJsonResponse";
import type { ScheduleSnapshot, ScheduleSnapshotEntry } from "@/types/electron";
import { usePersonalTimezone } from "./usePersonalTimezone";
import { StatusNotice } from "./UiState";

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
  const [view, setView] = useState<ScheduleCalendarView>("month");
  const [dragging, setDragging] = useState<{ entry: ScheduleSnapshotEntry; mode: ScheduleDragMode } | null>(null);
  const [savingEntryId, setSavingEntryId] = useState<string | null>(null);
  const today = new Date();
  const [anchor, setAnchor] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const eventFormRef = useRef<HTMLDivElement>(null);

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
    for (const entry of snapshot?.entries ?? []) {
      const key = entryDateKey(entry);
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return map;
  }, [snapshot]);

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
  const navigationUnit = view === "month" ? "month" : view === "day" ? "day" : "week";

  function openEventForm(date: string) {
    setEventDraftDate(date);
    window.requestAnimationFrame(() => {
      eventFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

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
    window.electronAPI?.notion.open(entry.notion_page_id).catch(() => {
      setMessage("Mi could not open that page in Notion.");
    });
  }

  async function applyDrop(newDate: string, targetMinutes?: number) {
    if (!dragging) return;
    if (savingEntryId) {
      setDragging(null);
      setMessage("Wait for the current calendar change to finish syncing.");
      return;
    }
    const previousSnapshot = snapshot;
    try {
      if (dragging.mode === "duplicate") {
        const proposal = buildDragDuplicateProposal(dragging.entry, newDate, crypto.randomUUID(), { targetMinutes, timezone });
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
      const proposal = buildDragRescheduleProposal(dragging.entry, newDate, crypto.randomUUID(), {
        mode: dragging.mode,
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
    <section className="rounded-xl border border-border bg-card p-5">
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
            key={eventDraftDate}
            initialDate={eventDraftDate}
            onCancel={() => setEventDraftDate(null)}
            onApplied={syncNow}
          />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Drag to move; hold Ctrl (Command on Mac) while dragging to duplicate. In week or day views, drag a timed Date range’s bottom handle to resize. Changes save to Notion and sync automatically.</p>
        <div className="inline-flex rounded-md border border-border p-1" aria-label="Calendar view">
          {(["month", "week", "work-week", "day"] as const).map((option) => (
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
      <h3 className="mt-3 text-center font-medium">{scheduleViewHeading(anchor, view)}</h3>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-muted-foreground" />Personal / internal</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-accent" />Project-linked · stable color per project</span>
      </div>
      {(outsideSnapshotWindow || snapshotIsStale) && (
        <StatusNotice tone="warning" title="Refresh recommended" className="mt-2">
          {outsideSnapshotWindow
            ? `This view extends beyond Mi’s cached ${snapshot?.window.from} to ${snapshot?.window.to} schedule window, so blank dates may not be empty in Notion. Sync now before relying on them.`
            : "This schedule snapshot is more than 8 hours old. Sync now before making planning decisions."}
        </StatusNotice>
      )}
      {view === "month" ? (
        <MonthScheduleView
          days={days}
          anchor={anchor}
          todayKey={todayKey}
          entriesByDate={entriesByDate}
          onOpen={openInNotion}
          onDragStart={beginDrag}
          onDragEnd={() => setDragging(null)}
          onDrop={(date) => void applyDrop(date)}
          onCreate={openEventForm}
          timezone={timezone}
          savingEntryId={savingEntryId}
        />
      ) : (
        <TimedScheduleView
          view={view}
          days={days}
          todayKey={todayKey}
          entriesByDate={entriesByDate}
          onOpen={openInNotion}
          onDragStart={beginDrag}
          onDragEnd={() => setDragging(null)}
          onDrop={(date, minutes) => void applyDrop(date, minutes)}
          onCreate={openEventForm}
          timezone={timezone}
          savingEntryId={savingEntryId}
          dragging={dragging}
        />
      )}
      {message && <p role="status" className="mt-3 text-xs text-muted-foreground">{message}</p>}

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
