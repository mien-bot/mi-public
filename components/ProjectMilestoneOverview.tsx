"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MilestoneBatchAction, MilestoneBatchPreview } from "@/lib/content/milestoneBatch";
import { computeMilestoneStatus } from "@/lib/content/status";
import type { Milestone } from "@/lib/schema";
import { NotionLink } from "./NotionLink";
import { MilestoneStatusControl, RefreshMilestonesFromNotion } from "./MilestoneStatusControl";

// "at-risk" uses an indigo/blue-violet treatment (matching --status-warning)
// rather than amber/orange — see docs/design/blue-palette.md.
const STATUS_STYLES = {
  complete: "border-emerald-500/40 bg-emerald-500/5",
  overdue: "border-red-500/40 bg-red-500/5",
  "at-risk": "border-indigo-500/40 bg-indigo-500/5",
  "on-track": "border-border",
};

export function ProjectMilestoneOverview({ slug, milestones, healthExplanation, scheduleHash }: {
  slug: string;
  milestones: Milestone[];
  healthExplanation: string;
  scheduleHash: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<MilestoneBatchPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; status: string; message: string }[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [finishedIds, setFinishedIds] = useState<string[]>([]);
  const ordered = milestones.filter((item) => !item.archived_at).sort((a, b) => a.planned_date.localeCompare(b.planned_date));
  const archived = milestones.filter((item) => item.archived_at);
  const selectable = (showArchived ? archived : ordered).filter((item) => !finishedIds.includes(item.id));
  const selection = selectable.filter((item) => selected.includes(item.id));
  const buttonClass = "rounded-md border border-border px-3 py-2 text-xs hover:border-accent disabled:opacity-40";
  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
    setPreview(null);
  }
  async function requestBatch(action: MilestoneBatchAction, confirmed = false) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/schedule/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: selection.map((item) => item.id), expectedHash: scheduleHash, confirmed, fingerprint: confirmed ? preview?.fingerprint : undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not process these milestones.");
      if (!confirmed) { setPreview(data); setResults([]); }
      else {
        setResults(data.results); setMessage(data.warning || ""); setPreview(null); setSelected([]);
        setFinishedIds(data.results.filter((item: { status: string }) => item.status === "applied").map((item: { id: string }) => item.id));
        router.refresh();
      }
    } catch (cause) {
      setPreview(null);
      setMessage(cause instanceof Error ? cause.message : "Could not process these milestones.");
    } finally { setBusy(false); }
  }
  const grouped = {
    overdue: ordered.filter((item) => computeMilestoneStatus(item) === "overdue"),
    upcoming: ordered.filter((item) => ["at-risk", "on-track"].includes(computeMilestoneStatus(item))),
    past: ordered
      .filter((item) => computeMilestoneStatus(item) === "complete")
      .sort((a, b) => (b.actual_date ?? b.planned_date).localeCompare(a.actual_date ?? a.planned_date)),
  };
  const notionLinked = milestones.some((item) => Boolean(item.notion_event_id));
  return (
    <section className="rounded-lg border border-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-medium">Plan & Timeline</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{healthExplanation}</p></div>
        <div className="flex flex-wrap justify-end gap-2">
          <RefreshMilestonesFromNotion slug={slug} notionLinked={notionLinked} />
          <Link href={`/projects/${slug}/schedule`} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent">Open timeline & planning</Link>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Bulk milestone actions">
        <span className="text-xs text-muted-foreground">{selection.length} selected</span>
        <button className={buttonClass} disabled={busy} onClick={() => { setShowArchived(!showArchived); setSelected([]); setPreview(null); setFinishedIds([]); }}>{showArchived ? "Show active deadlines" : `Archived (${archived.length})`}</button>
        <button className={buttonClass} disabled={busy || !selectable.length} onClick={() => { setSelected(selectable.slice(0, 100).map((item) => item.id)); setPreview(null); }}>Select {showArchived ? "archived" : "all active"}</button>
        {!showArchived && <button className={buttonClass} disabled={busy || !grouped.overdue.length} onClick={() => { setSelected(grouped.overdue.filter((item) => !finishedIds.includes(item.id)).slice(0, 100).map((item) => item.id)); setPreview(null); }}>Select overdue</button>}
        <button className={buttonClass} disabled={busy || !selection.length} onClick={() => { setSelected([]); setPreview(null); }}>Clear</button>
        <button className={buttonClass} disabled={busy || !selection.length} onClick={() => requestBatch(showArchived ? "restore" : "archive")}>{showArchived ? "Restore selected" : "Archive selected"}</button>
        <button className={buttonClass} disabled={busy || !selection.length} onClick={() => requestBatch("delete")}>Delete selected</button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Select up to 100 items. Archive hides them from active deadlines in Mi and keeps them available to restore.</p>
      {busy && <p role="status" className="mt-2 text-sm">{preview ? "Applying reviewed changes…" : "Preparing review…"}</p>}
      {message && <p role="alert" className="mt-2 text-sm">{message}</p>}
      {preview && <div role="region" aria-label="Review milestone changes" className="mt-3 rounded-md border border-accent bg-card p-4">
        <h3 className="font-medium">Review {preview.action}: {preview.items.length} item(s)</h3>
        <p className="mt-2 text-sm">{preview.action === "delete" ? "Mi-local items will be removed. Linked items will also move to Notion Trash, where they can be restored. Each item has its own result; earlier changes remain if a later item fails." : preview.action === "archive" ? "These items will be archived in Mi. Their Notion pages and completion status stay unchanged." : "These items will return to active views in Mi with their existing dates and status."}</p>
        <ul className="my-3 max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-sm">{preview.items.map((item) => <li key={item.id}>{item.name} · {item.plannedDate.slice(0, 10)} · {item.notion ? `Mi + Notion Trash (${item.notion.name})` : "Mi only"}</li>)}</ul>
        <div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={() => requestBatch(preview.action, true)}>Confirm {preview.action} of {preview.items.length} item(s)</button><button className={buttonClass} disabled={busy} onClick={() => setPreview(null)}>Cancel</button></div>
      </div>}
      {results.length > 0 && <ul aria-label="Milestone action results" className="mt-3 space-y-1 text-sm">{results.map((item) => <li key={item.id}>{item.name}: {item.message}</li>)}</ul>}
      {showArchived ? <ul className="mt-4 space-y-2">{archived.map((item) => <li key={item.id} className="rounded-md border border-border p-3 text-sm"><label className="flex items-start gap-2"><input type="checkbox" aria-label={`Select ${item.name}`} checked={selected.includes(item.id)} disabled={busy || finishedIds.includes(item.id)} onChange={() => toggle(item.id)} /><span>{item.name}<span className="mt-1 block text-xs text-muted-foreground">{item.planned_date.slice(0, 10)} · Archived in Mi</span></span></label></li>)}{!archived.length && <li className="text-sm text-muted-foreground">No archived deadlines.</li>}</ul> : <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {(["overdue", "upcoming", "past"] as const).map((group) => (
          <div key={group}>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group === "past" ? "Past deadlines" : group} ({grouped[group].length})</h3>
            <ul className="mt-2 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
              {grouped[group].map((item) => {
                const status = computeMilestoneStatus(item);
                const notionUrl = item.notion_event_id ? `https://www.notion.so/${item.notion_event_id.replaceAll("-", "")}` : null;
                return <li key={item.id} className={`rounded-md border p-3 text-sm ${STATUS_STYLES[status]}`}>
                  <label className="flex items-start gap-2 font-medium"><input type="checkbox" aria-label={`Select ${item.name}`} checked={selected.includes(item.id)} disabled={busy || finishedIds.includes(item.id)} onChange={() => toggle(item.id)} /><span>{item.name}</span></label>
                  <div className="mt-1 text-xs text-muted-foreground">{item.planned_date.slice(0, 10)} · {item.actual_date ? `completed ${item.actual_date}` : status} · {notionUrl ? <NotionLink href={notionUrl}>Notion-linked</NotionLink> : item.sync_key ? "Notion sync pending review" : "Mi-local"}</div>
                  <MilestoneStatusControl
                    slug={slug}
                    id={item.id}
                    plannedDate={item.planned_date}
                    completedDate={item.actual_date}
                    notionLinked={Boolean(item.notion_event_id)}
                    scheduleHash={scheduleHash}
                  />
                </li>;
              })}
              {grouped[group].length === 0 && <li className="text-sm text-muted-foreground">None.</li>}
            </ul>
          </div>
        ))}
      </div>}
    </section>
  );
}
