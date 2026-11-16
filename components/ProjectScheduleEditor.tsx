"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { scheduleTypeSchema, type Milestone, type ScheduleDraftItem, type ScheduleType } from "@/lib/schema";
import { computeMilestoneStatus } from "@/lib/content/status";
import { dateInTimezone } from "@/lib/content/timezone";
import { NotionLink } from "./NotionLink";
import { DeleteRecordButton } from "@/components/DeleteRecordButton";
import { canonicalTimestampInTimezone, localDateTimeToCanonical } from "@/lib/content/timezone";
import { formatDay } from "@/lib/displayDate";
import { isScheduleEvent, milestoneCategory, scheduleKind, slipWarnings, type ScheduleKind, type TimelineRow } from "@/lib/scheduleInsights";
import { CategoryPicker } from "./CategoryPicker";
import { MilestonePeek } from "./MilestonePeek";
import { ScheduleKindMark } from "./ScheduleKindMark";
import { StatusBadge } from "./StatusBadge";
import { ProjectMilestoneCalendar, type QuickAddItem } from "./ProjectMilestoneCalendar";
import { usePersonalTimezone } from "./usePersonalTimezone";

type Draft = ScheduleDraftItem & { selected: boolean };
type Confirmation =
  | { kind: "sync"; items: Draft[] }
  | { kind: "send-notion"; items: Milestone[] }
  | { kind: "local"; item: Draft }
  | { kind: "update"; id: string; plannedDate: string; actualDate: string | null; syncNotion: boolean; action?: "complete" | "reopen"; priority?: Milestone["priority"] | "auto"; startTime?: string | null; startAt?: string; type?: ScheduleType };

const LIST_VIEWS: [ScheduleKind | "all", string][] = [["all", "All"], ["milestone", "Milestones"], ["client", "Client meetings"], ["meeting", "Meetings"], ["work", "Work sessions"]];

class ScheduleRequestError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export function ProjectScheduleEditor({ slug, milestones, initialHash, notionLinked, row }: {
  slug: string;
  milestones: Milestone[];
  initialHash: string | null;
  notionLinked: boolean;
  row: TimelineRow;
}) {
  const router = useRouter();
  const { timezone } = usePersonalTimezone();
  const [name, setName] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [type, setType] = useState<ScheduleType>("Deadline");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dates, setDates] = useState(() => Object.fromEntries(milestones.map((item) => [item.id, { planned: item.planned_date.slice(0, 10), actual: item.actual_date ?? "" }])));
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [scheduleHash, setScheduleHash] = useState(initialHash);
  // Undo runs after a save has replaced the hash this render captured.
  const scheduleHashRef = useRef(initialHash);
  const today = dateInTimezone(new Date(), timezone);
  const [conflict, setConflict] = useState(false);
  const [notionMissing, setNotionMissing] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [listView, setListView] = useState<ScheduleKind | "all">("all");
  const [peekId, setPeekId] = useState<string | null>(null);
  const peek = milestones.find((item) => item.id === peekId) ?? null;
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<(() => void) | null>(null);
  const [results, setResults] = useState<{ name: string; status: string; error?: string }[]>([]);

  const ordered = useMemo(() => [...milestones].sort((a, b) => a.planned_date.localeCompare(b.planned_date)), [milestones]);
  const paymentDrafts = row.details.payments.filter((payment) => payment.due_date && !payment.paid_date
    && !milestones.some((item) => item.name === `Payment due: ${payment.label}`)
    && !drafts.some((item) => item.name === `Payment due: ${payment.label}`));

  function addPaymentDrafts() {
    setDrafts((current) => [...current, ...paymentDrafts.map((payment) => ({
      client_request_id: crypto.randomUUID(), name: `Payment due: ${payment.label}`, date: payment.due_date,
      type: "Deadline" as ScheduleType, start_time: null, end_time: null, selected: true,
    }))]);
    setMessage("Payment drafts added. Nothing has been written locally or to Notion.");
  }
  const isOpen = Boolean(confirmation);
  useEffect(() => { if (isOpen) confirmButton.current?.focus(); }, [isOpen]);
  const sendable = (item: Milestone) => !item.notion_event_id && !item.sync_key;
  const awaitingCheck = (item: Milestone) => !item.notion_event_id && item.sync_key === `send-${item.id}`;
  const unsent = useMemo(() => milestones.filter(sendable), [milestones]);
  const listed = useMemo(() => ordered.filter((item) => listView === "all" || scheduleKind(item) === listView), [ordered, listView]);

  function closeConfirmation() {
    setConfirmation(null);
    setConflict(false);
    setNotionMissing(false);
    setDialogError("");
  }

  async function sendToNotion(milestone: Milestone) {
    const date = milestone.planned_date.slice(0, 10);
    const startAt = milestone.start_time ? localDateTimeToCanonical(date, milestone.start_time, timezone) : null;
    const endAt = startAt ? canonicalTimestampInTimezone(new Date(Date.parse(startAt) + 3_600_000), timezone) : null;
    const data = await request({ operation: "send-local", confirmed: true, id: milestone.id, startAt, endAt });
    return data.result as { name: string; status: string; error?: string };
  }

  /** The person checked Notion and it never arrived, so a new send cannot make a second row. */
  async function allowRetry(milestone: Milestone) {
    setBusy(true);
    try {
      await request({ operation: "allow-send-retry", confirmed: true, id: milestone.id });
      setMessage(`${milestone.name} can be sent again.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That could not be changed.");
    } finally { setBusy(false); }
  }

  /** A linked item's category also changes Notion, which asks first. The rest save with Undo. */
  function changeCategory(milestone: Milestone, type: ScheduleType) {
    if (!milestone.notion_event_id) return void saveLabel(milestone, { type }, milestone.type ?? null);
    setConfirmation({
      kind: "update", id: milestone.id, plannedDate: milestone.planned_date.slice(0, 10),
      actualDate: milestone.actual_date, syncNotion: true, type,
    });
  }

  /** Priority is Mi's own label, so the control itself is the confirmation. */
  async function saveLabel(milestone: Milestone, label: { type?: ScheduleType | null; priority?: Milestone["priority"] | "auto" }, undoType?: ScheduleType | null) {
    setBusy(true);
    setUndo(null);
    try {
      await request({
        ...label, id: milestone.id, plannedDate: milestone.planned_date.slice(0, 10), actualDate: milestone.actual_date,
        syncNotion: false, operation: "update", confirmed: true, expectedHash: scheduleHashRef.current,
      }, "PATCH");
      setMessage(label.type ? `${milestone.name} is now ${label.type}.` : label.type === null ? "Category restored." : "Priority saved in Mi only.");
      if (undoType !== undefined) setUndo(() => () => void saveLabel(milestone, { type: undoType }));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof ScheduleRequestError && error.code === "conflict"
        ? "This schedule changed elsewhere. Reload the page and try again."
        : error instanceof Error ? error.message : "The change could not be saved.");
    } finally { setBusy(false); }
  }

  async function quickAdd(item: QuickAddItem): Promise<boolean> {
    const draft: Draft = {
      client_request_id: crypto.randomUUID(), name: item.name, date: item.date, type: item.type, selected: true,
      start_time: null, end_time: null,
    };
    if (item.time) {
      const start = localDateTimeToCanonical(item.date, item.time, timezone);
      draft.start_time = start;
      draft.end_time = canonicalTimestampInTimezone(new Date(Date.parse(start) + 3_600_000), timezone);
    }
    try {
      if (item.toNotion) {
        await request({ operation: "sync", confirmed: false, items: [draft] });
        setConfirmation({ kind: "sync", items: [draft] });
      } else {
        await request({ operation: "save-local", confirmed: true, item: draft });
        setMessage(`${item.name} saved to Mi.`);
        router.refresh();
      }
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "It could not be added.");
      return false;
    }
  }

  const moveWarnings = confirmation?.kind === "update" && !confirmation.action
    ? slipWarnings(row.details, milestones.find((item) => item.id === confirmation.id)?.planned_date.slice(0, 10) ?? confirmation.plannedDate, confirmation.plannedDate)
    : [];

  /**
   * Removes one Mi-local milestone. Throws on failure so the shared control shows the
   * reason — a hash conflict means the schedule moved under this page and the person needs
   * to reload rather than have their delete silently drop someone else's new milestone.
   */
  async function removeMilestone(id: string) {
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/schedule`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, id, expectedHash: scheduleHash }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "The milestone could not be deleted.");
    scheduleHashRef.current = data.hash ?? null;
    setScheduleHash(data.hash ?? null);
    setUndo(null);
    setMessage("Milestone deleted.");
    router.refresh();
  }

  function addDraft(event: React.FormEvent) {
    event.preventDefault();
    setDrafts((current) => [...current, {
      client_request_id: crypto.randomUUID(), name: name.trim(), date: plannedDate, type,
      start_time: null, end_time: null, selected: true,
    }]);
    setName("");
    setPlannedDate("");
    setMessage("Draft added. Nothing has been written locally or to Notion.");
  }

  async function request(body: object, method: "POST" | "PATCH" = "POST") {
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/schedule`, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (typeof data.hash === "string" || data.hash === null) { scheduleHashRef.current = data.hash; setScheduleHash(data.hash); }
    if (!response.ok) throw new ScheduleRequestError(data.error || "Schedule request failed.", data.error);
    return data;
  }

  async function previewSync() {
    const selected = drafts.filter((item) => item.selected);
    if (!selected.length) return setMessage("Select at least one draft item.");
    setBusy(true);
    try {
      await request({ operation: "sync", confirmed: false, items: selected });
      setConfirmation({ kind: "sync", items: selected });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Preview failed."); }
    finally { setBusy(false); }
  }

  async function applyConfirmed(localOnly = false) {
    if (!confirmation) return;
    setBusy(true);
    setConflict(false);
    setNotionMissing(false);
    setDialogError("");
    try {
      if (confirmation.kind === "send-notion") {
        const report: { name: string; status: string; error?: string }[] = [];
        for (const milestone of confirmation.items) {
          report.push(await sendToNotion(milestone));
        }
        const sent = report.filter((item) => item.status === "success" || item.status === "already-applied").length;
        setResults(report.filter((item) => item.status !== "success" && item.status !== "already-applied"));
        setMessage(`${sent} of ${report.length} sent to Notion.`);
      } else if (confirmation.kind === "sync") {
        const data = await request({ operation: "sync", confirmed: true, items: confirmation.items });
        setResults(data.results);
        const successful = new Set(data.results.filter((result: { status: string }) => ["success", "already-applied"].includes(result.status)).map((result: { client_request_id: string }) => result.client_request_id));
        setDrafts((current) => current.filter((item) => !successful.has(item.client_request_id)));
      } else if (confirmation.kind === "local") {
        await request({ operation: "save-local", confirmed: true, item: confirmation.item });
        setDrafts((current) => current.filter((item) => item.client_request_id !== confirmation.item.client_request_id));
        setMessage("Milestone saved to Mi only.");
      } else {
        await request({
          ...confirmation,
          ...(localOnly ? { syncNotion: false } : {}),
          operation: "update",
          confirmed: true,
          expectedHash: scheduleHash,
        }, "PATCH");
        setDates((current) => ({
          ...current,
          [confirmation.id]: {
            planned: confirmation.plannedDate,
            actual: confirmation.actualDate ?? "",
          },
        }));
        const actionLabel = confirmation.action === "complete"
          ? "marked complete"
          : confirmation.action === "reopen"
            ? "reopened"
            : "updated";
        if (confirmation.type) setMessage(`${milestones.find((item) => item.id === confirmation.id)?.name ?? "Item"} is now ${confirmation.type}${confirmation.syncNotion && !localOnly ? " in Mi and Notion" : " in Mi"}.`);
        else setMessage(confirmation.syncNotion && !localOnly
          ? `Milestone ${actionLabel} in Mi and Notion.`
          : `Milestone ${actionLabel} in Mi.`);
      }
      closeConfirmation();
      router.refresh();
    } catch (error) {
      if (error instanceof ScheduleRequestError && error.code === "conflict") {
        setConflict(true);
        setDialogError("This was changed elsewhere since you loaded it. Reload and review the latest schedule before saving again.");
      } else if (error instanceof ScheduleRequestError && error.code === "notion-type-disabled") {
        setNotionMissing(true);
        setDialogError("Changing Notion types is turned off on this computer, so Notion was not changed. You can save this in Mi only.");
      } else if (error instanceof ScheduleRequestError && error.code === "notion-row-missing") {
        setNotionMissing(true);
        setDialogError("This item no longer exists in Notion, so Notion could not be updated. Nothing was changed. You can apply this in Mi only.");
      } else {
        setDialogError(error instanceof Error ? error.message : "Confirmed change failed.");
      }
    }
    finally { setBusy(false); }
  }

  /** Saves a Mi-only move, then offers the way back. Notion rows still confirm first. */
  async function moveLocal(milestone: Milestone, date: string, startTime: string | null, offerUndo: boolean) {
    const previous = { date: milestone.planned_date.slice(0, 10), startTime: milestone.start_time ?? null };
    setBusy(true);
    setUndo(null);
    try {
      await request({
        id: milestone.id, plannedDate: date, actualDate: milestone.actual_date, startTime, syncNotion: false,
        operation: "update", confirmed: true, expectedHash: scheduleHashRef.current,
      }, "PATCH");
      setDates((current) => ({ ...current, [milestone.id]: { planned: date, actual: milestone.actual_date ?? "" } }));
      const warnings = slipWarnings(row.details, previous.date, date);
      setMessage(offerUndo ? [`Moved to ${formatDay(date, today)}${startTime ? ` at ${startTime}` : ""}.`, ...warnings].join(" ") : "Move undone.");
      if (offerUndo) setUndo(() => () => void moveLocal({ ...milestone, planned_date: date, start_time: startTime ?? undefined }, previous.date, previous.startTime, false));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof ScheduleRequestError && error.code === "conflict"
        ? "This schedule changed elsewhere. Reload the page and try again."
        : error instanceof Error ? error.message : "The move could not be saved.");
    } finally { setBusy(false); }
  }

  function proposeCalendarMove(milestone: Milestone, newDate: string, time?: string | null) {
    const startTime = time === undefined ? milestone.start_time ?? null : time;
    if (!milestone.notion_event_id) return void moveLocal(milestone, newDate, startTime, true);
    setConfirmation({
      kind: "update",
      id: milestone.id,
      plannedDate: newDate,
      actualDate: (dates[milestone.id]?.actual ?? milestone.actual_date) || null,
      syncNotion: true,
      startTime,
      ...(time ? { startAt: localDateTimeToCanonical(newDate, time, timezone) } : {}),
    });
  }

  function selectCalendarMilestone(milestone: Milestone) {
    setPeekId(milestone.id);
  }

  function openInTimeline(milestone: Milestone) {
    setPeekId(null);
    setListView("all");
    setHighlighted(milestone.id);
    window.setTimeout(() => document.getElementById(`milestone-${milestone.id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    }), 0);
  }

  function renderRow(milestone: Milestone) {
    const status = computeMilestoneStatus(milestone);
    const edit = dates[milestone.id] ?? { planned: milestone.planned_date.slice(0, 10), actual: milestone.actual_date ?? "" };
    const changed = edit.planned !== milestone.planned_date.slice(0, 10) || edit.actual !== (milestone.actual_date ?? "");
    const notionUrl = milestone.notion_event_id ? `https://www.notion.so/${milestone.notion_event_id.replaceAll("-", "")}` : null;
    return <li id={`milestone-${milestone.id}`} key={milestone.id} className={`relative scroll-mt-24 ${highlighted === milestone.id ? "bg-accent/10" : ""}`}>
      <details open={highlighted === milestone.id || undefined}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 py-2.5 pl-3 pr-32 hover:bg-muted/40">
          <ScheduleKindMark kind={scheduleKind(milestone)} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{milestone.name}</span>
          {awaitingCheck(milestone) && <span className="text-xs text-status-warning-foreground">Check Notion</span>}
          <span className="text-xs tabular-nums text-muted-foreground">{formatDay(milestone.planned_date, today)}{milestone.start_time ? ` ${milestone.start_time}` : ""}</span>
          {!isScheduleEvent(milestone) && <StatusBadge status={status} />}
        </summary>
        <div className="space-y-3 border-t border-border bg-background/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto]">
            <label className="text-xs text-muted-foreground">Planned date<input type="date" value={edit.planned} onChange={(event) => setDates((current) => ({ ...current, [milestone.id]: { ...edit, planned: event.target.value } }))} className="mt-1 block w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground" /></label>
            <label className="text-xs text-muted-foreground">Completed date<input type="date" value={edit.actual} onChange={(event) => setDates((current) => ({ ...current, [milestone.id]: { ...edit, actual: event.target.value } }))} className="mt-1 block w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground" /></label>
            <button type="button" disabled={!changed} onClick={() => setConfirmation({ kind: "update", id: milestone.id, plannedDate: edit.planned, actualDate: edit.actual || null, syncNotion: false })} className="self-end rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40">Save in Mi</button>
            {notionUrl && <button type="button" disabled={!changed} onClick={() => setConfirmation({ kind: "update", id: milestone.id, plannedDate: edit.planned, actualDate: edit.actual || null, syncNotion: true })} className="self-end rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40">Save in Mi + Notion</button>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full"><CategoryPicker value={milestoneCategory(milestone)} onChange={(type) => changeCategory(milestone, type)} disabled={busy} label={`Category for ${milestone.name}`} /></div>
            <label className="text-xs text-muted-foreground">Priority{" "}
              <select aria-label={`Priority for ${milestone.name}`} disabled={busy} value={milestone.priority ?? "auto"} onChange={(event) => void saveLabel(milestone, { priority: event.target.value as Milestone["priority"] | "auto" })} className="rounded-md border border-border bg-card px-1.5 py-1 text-foreground">
                <option value="auto">Automatic</option><option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option>
              </select>
            </label>
            {notionUrl && <NotionLink href={notionUrl}>Open in Notion</NotionLink>}
            {/* A Notion-linked milestone is refused by the server: Mi's copy mirrors a row that
                still exists over there, so deleting it here would look like a re-appearance. */}
            {!milestone.notion_event_id && (
              <DeleteRecordButton
                disabled={busy}
                prompt="Delete this milestone?"
                recoverableNote="The schedule's previous revision is kept on disk."
                onDelete={() => removeMilestone(milestone.id)}
              />
            )}
          </div>
        </div>
      </details>
      <button type="button" onClick={() => toggleComplete(milestone)} className="absolute right-3 top-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:border-accent">{milestone.actual_date ? "Reopen" : "Mark complete"}</button>
    </li>;
  }

  function toggleComplete(milestone: Milestone) {
    const edit = dates[milestone.id] ?? { planned: milestone.planned_date.slice(0, 10), actual: milestone.actual_date ?? "" };
    setConfirmation({
      kind: "update",
      id: milestone.id,
      plannedDate: edit.planned,
      actualDate: milestone.actual_date ? null : dateInTimezone(new Date(), timezone),
      syncNotion: Boolean(milestone.notion_event_id),
      action: milestone.actual_date ? "reopen" : "complete",
    });
  }

  const calendar = <ProjectMilestoneCalendar
    milestones={milestones}
    onMove={proposeCalendarMove}
    onSelect={selectCalendarMilestone}
    onQuickAdd={quickAdd}
    notionLinked={notionLinked}
    row={row}
  />;

  return (
    <div className="flex flex-col gap-6">
      {calendar}

      <details className="order-3 rounded-lg border border-border p-4" open={drafts.length > 0 || undefined}>
        <summary className="cursor-pointer font-medium">Draft several items at once{drafts.length > 0 ? ` (${drafts.length})` : ""}</summary>
        <p className="mt-1 text-sm text-muted-foreground">Build a batch, then save it to Mi or send it to Notion. Nothing is written until you confirm.</p>
        <form onSubmit={addDraft} className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New deadline or kick-off" required className="rounded-md border border-border bg-card px-3 py-2 text-sm" />
          <input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} required className="rounded-md border border-border bg-card px-3 py-2 text-sm" />
          <select value={type} onChange={(event) => setType(event.target.value as ScheduleType)} className="rounded-md border border-border bg-card px-3 py-2 text-sm">{scheduleTypeSchema.options.map((value) => <option key={value}>{value}</option>)}</select>
          <button className="rounded-md border border-border px-4 py-2 text-sm hover:border-accent">Add draft</button>
        </form>
        {paymentDrafts.length > 0 && <button type="button" onClick={addPaymentDrafts} className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm">Draft {paymentDrafts.length} payment {paymentDrafts.length === 1 ? "date" : "dates"} for the calendar and Notion</button>}
        {drafts.length > 0 && <div className="mt-4 space-y-2">
          {drafts.map((draft, index) => <div key={draft.client_request_id} className="grid items-center gap-2 rounded-md border border-border p-3 md:grid-cols-[auto_1fr_auto_auto_auto]">
            <input type="checkbox" checked={draft.selected} aria-label={`Select ${draft.name}`} onChange={(event) => setDrafts((current) => current.map((item, i) => i === index ? { ...item, selected: event.target.checked } : item))} />
            <input value={draft.name} onChange={(event) => setDrafts((current) => current.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} className="rounded-md border border-border bg-card px-2 py-1 text-sm" />
            <input type="date" value={draft.date} onChange={(event) => setDrafts((current) => current.map((item, i) => i === index ? { ...item, date: event.target.value } : item))} className="rounded-md border border-border bg-card px-2 py-1 text-sm" />
            <button type="button" onClick={() => setConfirmation({ kind: "local", item: draft })} className="rounded-md border border-border px-2 py-1 text-xs">Save Mi-local</button>
            <button type="button" onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))} className="text-xs text-muted-foreground hover:text-foreground">Remove</button>
          </div>)}
          <button type="button" disabled={!notionLinked || busy} onClick={() => void previewSync()} className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40">Preview selected for Notion</button>
          {!notionLinked && <span className="ml-3 text-sm text-muted-foreground">Link the project to Notion to sync; Mi-local save remains available.</span>}
        </div>}
      </details>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-medium">Timeline</h2>
            {notionLinked && unsent.length > 0 && <button type="button" disabled={busy} onClick={() => setConfirmation({ kind: "send-notion", items: unsent })} className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-accent">Send {unsent.length} Mi-only {unsent.length === 1 ? "item" : "items"} to Notion</button>}
          </div>
          <div className="inline-flex rounded-md border border-border p-1" role="group" aria-label="Timeline list">
            {LIST_VIEWS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={listView === value} onClick={() => setListView(value)} className={`rounded px-2.5 py-1 text-xs ${listView === value ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>{label} ({value === "all" ? ordered.length : ordered.filter((item) => scheduleKind(item) === value).length})</button>
            ))}
          </div>
        </div>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {listed.filter((item) => !item.actual_date).map(renderRow)}
          {listed.every((item) => item.actual_date) && <li className="p-4 text-sm text-muted-foreground">Nothing open here.</li>}
        </ul>
        {listed.some((item) => item.actual_date) && <details className="mt-3" open={listed.some((item) => item.actual_date && item.id === highlighted) || undefined}>
          <summary className="cursor-pointer text-sm text-muted-foreground">Done ({listed.filter((item) => item.actual_date).length})</summary>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">{listed.filter((item) => item.actual_date).map(renderRow)}</ul>
        </details>}
      </section>

      {peek && <MilestonePeek
        key={peek.id}
        milestone={peek}
        disabled={busy}
        onClose={() => setPeekId(null)}
        onToggleComplete={() => { setPeekId(null); toggleComplete(peek); }}
        onCategory={(type) => changeCategory(peek, type)}
        onSendToNotion={notionLinked && sendable(peek) ? () => setConfirmation({ kind: "send-notion", items: [peek] }) : undefined}
        onAllowRetry={awaitingCheck(peek) ? () => void allowRetry(peek) : undefined}
        onReschedule={(date, time) => { setPeekId(null); proposeCalendarMove(peek, date, time); }}
        onDelete={peek.notion_event_id ? undefined : async () => { await removeMilestone(peek.id); setPeekId(null); }}
        onOpenTimeline={() => openInTimeline(peek)}
      />}

      {message && <div role="status" className="fixed bottom-4 left-1/2 z-[75] flex max-w-lg -translate-x-1/2 items-start gap-3 rounded-lg border border-border bg-card px-4 py-2 text-sm shadow-lg">
        <span>{message}</span>
        {undo && <button type="button" disabled={busy} onClick={undo} className="font-medium text-link hover:underline">Undo</button>}
        <button type="button" aria-label="Dismiss" onClick={() => { setMessage(""); setUndo(null); }} className="text-muted-foreground hover:text-foreground">×</button>
      </div>}
      {results.length > 0 && <section className="rounded-lg border border-border p-4"><h3 className="font-medium">Notion apply report</h3><ul className="mt-2 space-y-1 text-sm">{results.map((result) => <li key={`${result.name}-${result.status}`}>{result.name}: {result.status}{result.error ? ` — ${result.error}` : ""}</li>)}</ul></section>}

      {confirmation && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="presentation">
        <div role="dialog" aria-modal="true" aria-labelledby="schedule-confirm-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) closeConfirmation(); }} className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-lg">
          <h2 id="schedule-confirm-title" className="font-medium">Confirm schedule change</h2>
          {moveWarnings.map((warning) => <p key={warning} className="mt-2 text-sm text-status-warning-foreground">{warning}</p>)}
          <p className="mt-2 text-sm text-muted-foreground">{confirmation.kind === "send-notion" ? (confirmation.items.length === 1 ? `“${confirmation.items[0].name}” will be added to STUDIO Schedule as ${milestoneCategory(confirmation.items[0])} on ${formatDay(confirmation.items[0].planned_date, today)}, linked to this project.` : `${confirmation.items.length} items will be added to STUDIO Schedule one by one, linked to this project.`) : confirmation.kind === "update" && confirmation.type ? `This changes it to ${confirmation.type} in Mi and Notion, so Studio and Google Calendar follow.` : confirmation.kind === "sync" ? `${confirmation.items.length} selected item(s) will be created in STUDIO Schedule one by one and linked to this exact project. Successful retries will be skipped.` : confirmation.kind === "local" ? `“${confirmation.item.name}” will be saved only to Mi.` : confirmation.action === "complete" ? `This milestone will be marked complete on ${confirmation.actualDate}${confirmation.syncNotion ? ", and Notion Status plus Completed Date will be updated" : " in Mi"}.` : confirmation.action === "reopen" ? `This milestone will be reopened and its completed date cleared${confirmation.syncNotion ? " in Mi and Notion" : " in Mi"}.` : confirmation.syncNotion ? `This moves it to ${formatDay(confirmation.plannedDate, today)}${confirmation.startTime ? ` at ${confirmation.startTime}` : ""} in Mi and Notion, keeping its length.` : "Only the Mi milestone will be updated; Notion will not change."}</p>
          {confirmation.kind === "send-notion" && confirmation.items.length > 1 && <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">{confirmation.items.map((item) => <li key={item.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{item.name}</span><span className="shrink-0 text-xs text-muted-foreground">{formatDay(item.planned_date, today)}</span></li>)}</ul>}
          {dialogError && <p role="alert" className="mt-3 text-sm text-status-danger-foreground">{dialogError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={closeConfirmation} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
            {conflict ? (
              <button type="button" onClick={() => { closeConfirmation(); window.location.reload(); }} className="rounded-md border border-border px-3 py-2 text-sm">Reload latest schedule</button>
            ) : notionMissing ? (
              <button type="button" disabled={busy} onClick={() => void applyConfirmed(true)} className="rounded-md bg-foreground px-3 py-2 text-sm text-background">{busy ? "Applying…" : "Apply in Mi only"}</button>
            ) : (
              <>
                {confirmation.kind === "update" && confirmation.type && <button type="button" disabled={busy} onClick={() => void applyConfirmed(true)} className="rounded-md border border-border px-3 py-2 text-sm">Save in Mi only</button>}
                <button ref={confirmButton} type="button" disabled={busy} onClick={() => void applyConfirmed()} className="rounded-md bg-foreground px-3 py-2 text-sm text-background">{busy ? "Applying…" : "Confirm and apply"}</button>
              </>
            )}
          </div>
        </div>
      </div>}
    </div>
  );
}
