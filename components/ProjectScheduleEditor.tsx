"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { scheduleTypeSchema, type Milestone, type ScheduleDraftItem, type ScheduleType } from "@/lib/schema";
import { computeMilestoneStatus } from "@/lib/content/status";
import { dateInTimezone } from "@/lib/content/timezone";
import { NotionLink } from "./NotionLink";
import { DeleteRecordButton } from "@/components/DeleteRecordButton";
import { ProjectMilestoneCalendar } from "./ProjectMilestoneCalendar";
import { usePersonalTimezone } from "./usePersonalTimezone";

type Draft = ScheduleDraftItem & { selected: boolean };
type Confirmation =
  | { kind: "sync"; items: Draft[] }
  | { kind: "local"; item: Draft }
  | { kind: "update"; id: string; plannedDate: string; actualDate: string | null; syncNotion: boolean; action?: "complete" | "reopen" };

class ScheduleRequestError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export function ProjectScheduleEditor({ slug, milestones, initialHash, notionLinked }: {
  slug: string;
  milestones: Milestone[];
  initialHash: string | null;
  notionLinked: boolean;
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
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<{ name: string; status: string; error?: string }[]>([]);

  const ordered = useMemo(() => [...milestones].sort((a, b) => a.planned_date.localeCompare(b.planned_date)), [milestones]);

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
    setScheduleHash(data.hash ?? null);
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
    const data = await response.json();
    if (typeof data.hash === "string" || data.hash === null) setScheduleHash(data.hash);
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

  async function applyConfirmed() {
    if (!confirmation) return;
    setBusy(true);
    setConflict(false);
    try {
      if (confirmation.kind === "sync") {
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
        setMessage(confirmation.syncNotion
          ? `Milestone ${actionLabel} in Mi and Notion.`
          : `Milestone ${actionLabel} in Mi.`);
      }
      setConfirmation(null);
      router.refresh();
    } catch (error) {
      if (error instanceof ScheduleRequestError && error.code === "conflict") {
        setConflict(true);
        setMessage("This was changed elsewhere since you loaded it. Reload and review the latest schedule before saving again.");
      } else {
        setMessage(error instanceof Error ? error.message : "Confirmed change failed.");
      }
    }
    finally { setBusy(false); }
  }

  function proposeCalendarMove(milestone: Milestone, newDate: string) {
    const edit = dates[milestone.id] ?? {
      planned: milestone.planned_date.slice(0, 10),
      actual: milestone.actual_date ?? "",
    };
    setConfirmation({
      kind: "update",
      id: milestone.id,
      plannedDate: newDate,
      actualDate: edit.actual || null,
      syncNotion: Boolean(milestone.notion_event_id),
    });
  }

  function selectCalendarMilestone(milestone: Milestone) {
    document.getElementById(`milestone-${milestone.id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-medium">Draft a milestone</h2><p className="text-sm text-muted-foreground">Editing this form never writes to Notion. Add drafts, review them, select individual items, then confirm.</p></div>
          <span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">Draft → Preview → Select → Confirm → Apply</span>
        </div>
        <form onSubmit={addDraft} className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New deadline or kick-off" required className="rounded-md border border-border bg-card px-3 py-2 text-sm" />
          <input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} required className="rounded-md border border-border bg-card px-3 py-2 text-sm" />
          <select value={type} onChange={(event) => setType(event.target.value as ScheduleType)} className="rounded-md border border-border bg-card px-3 py-2 text-sm">{scheduleTypeSchema.options.map((value) => <option key={value}>{value}</option>)}</select>
          <button className="rounded-md border border-border px-4 py-2 text-sm hover:border-accent">Add draft</button>
        </form>
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
      </section>

      <ProjectMilestoneCalendar
        milestones={milestones}
        onMove={proposeCalendarMove}
        onSelect={selectCalendarMilestone}
      />

      <section>
        <h2 className="font-medium">Chronological timeline</h2>
        <div className="mt-4 border-l border-border pl-5">
          {ordered.map((milestone) => {
            const status = computeMilestoneStatus(milestone);
            const edit = dates[milestone.id] ?? { planned: milestone.planned_date.slice(0, 10), actual: milestone.actual_date ?? "" };
            const changed = edit.planned !== milestone.planned_date.slice(0, 10) || edit.actual !== (milestone.actual_date ?? "");
            const notionUrl = milestone.notion_event_id ? `https://www.notion.so/${milestone.notion_event_id.replaceAll("-", "")}` : null;
            return <article id={`milestone-${milestone.id}`} key={milestone.id} className="relative mb-4 rounded-lg border border-border p-4">
              <span className="absolute -left-[1.75rem] top-5 h-3 w-3 rounded-full border-2 border-background bg-accent" />
              <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-medium">{milestone.name}</h3><p className="text-xs text-muted-foreground">{status} · {notionUrl ? <NotionLink href={notionUrl}>Notion-linked item</NotionLink> : milestone.sync_key ? "Notion sync pending review" : "Mi-local milestone"}</p></div></div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto]">
                <label className="text-xs text-muted-foreground">Planned date<input type="date" value={edit.planned} onChange={(event) => setDates((current) => ({ ...current, [milestone.id]: { ...edit, planned: event.target.value } }))} className="mt-1 block w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground" /></label>
                <label className="text-xs text-muted-foreground">Actual / completed date<input type="date" value={edit.actual} onChange={(event) => setDates((current) => ({ ...current, [milestone.id]: { ...edit, actual: event.target.value } }))} className="mt-1 block w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground" /></label>
                <button type="button" disabled={!changed} onClick={() => setConfirmation({ kind: "update", id: milestone.id, plannedDate: edit.planned, actualDate: edit.actual || null, syncNotion: false })} className="self-end rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40">Confirm Mi update</button>
                {notionUrl && <button type="button" disabled={!changed} onClick={() => setConfirmation({ kind: "update", id: milestone.id, plannedDate: edit.planned, actualDate: edit.actual || null, syncNotion: true })} className="self-end rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40">Confirm Mi + Notion date</button>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                {edit.actual ? (
                  <button type="button" onClick={() => setConfirmation({
                    kind: "update",
                    id: milestone.id,
                    plannedDate: edit.planned,
                    actualDate: null,
                    syncNotion: Boolean(notionUrl),
                    action: "reopen",
                  })} className="rounded-md border border-border px-3 py-2 text-sm">Reopen milestone</button>
                ) : (
                  <button type="button" onClick={() => setConfirmation({
                    kind: "update",
                    id: milestone.id,
                    plannedDate: edit.planned,
                    actualDate: dateInTimezone(new Date(), timezone),
                    syncNotion: Boolean(notionUrl),
                    action: "complete",
                  })} className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Mark complete today</button>
                )}
                <span className="text-xs text-muted-foreground">{notionUrl ? "Updates Mi and the linked Notion milestone after confirmation." : "Updates this Mi-local milestone after confirmation."}</span>
                {/* A Notion-linked milestone is refused by the server: Mi's copy mirrors a
                    row that still exists over there, so deleting it here would only make the
                    next sync look like a re-appearance. Remove it in Notion first. */}
                {!milestone.notion_event_id && (
                  <DeleteRecordButton
                    disabled={busy}
                    prompt="Delete this milestone?"
                    recoverableNote="The schedule's previous revision is kept on disk."
                    onDelete={() => removeMilestone(milestone.id)}
                  />
                )}
              </div>
            </article>;
          })}
          {ordered.length === 0 && <p className="text-sm text-muted-foreground">No milestones yet.</p>}
        </div>
      </section>

      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {results.length > 0 && <section className="rounded-lg border border-border p-4"><h3 className="font-medium">Notion apply report</h3><ul className="mt-2 space-y-1 text-sm">{results.map((result) => <li key={`${result.name}-${result.status}`}>{result.name}: {result.status}{result.error ? ` — ${result.error}` : ""}</li>)}</ul></section>}

      {confirmation && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="presentation">
        <div role="dialog" aria-modal="true" aria-labelledby="schedule-confirm-title" className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-lg">
          <h2 id="schedule-confirm-title" className="font-medium">Confirm schedule change</h2>
          <p className="mt-2 text-sm text-muted-foreground">{confirmation.kind === "sync" ? `${confirmation.items.length} selected item(s) will be created in STUDIO Schedule one by one and linked to this exact project. Successful retries will be skipped.` : confirmation.kind === "local" ? `“${confirmation.item.name}” will be saved only to Mi.` : confirmation.action === "complete" ? `This milestone will be marked complete on ${confirmation.actualDate}${confirmation.syncNotion ? ", and Notion Status plus Completed Date will be updated" : " in Mi"}.` : confirmation.action === "reopen" ? `This milestone will be reopened and its completed date cleared${confirmation.syncNotion ? " in Mi and Notion" : " in Mi"}.` : confirmation.syncNotion ? "The Mi milestone and its linked Notion Date, Status, and Completed Date properties will be updated." : "Only the Mi milestone will be updated; Notion will not change."}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => { setConfirmation(null); setConflict(false); }} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
            {conflict ? (
              <button type="button" onClick={() => router.refresh()} className="rounded-md border border-border px-3 py-2 text-sm">Reload latest schedule</button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void applyConfirmed()} className="rounded-md bg-foreground px-3 py-2 text-sm text-background">{busy ? "Applying…" : "Confirm and apply"}</button>
            )}
          </div>
        </div>
      </div>}
    </div>
  );
}
