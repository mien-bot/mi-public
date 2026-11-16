"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDay } from "@/lib/displayDate";
import type { ProjectAsk } from "@/lib/projectAsks";
import type { Milestone, ScheduleType } from "@/lib/schema";

const DISMISSED_KEY = (slug: string) => `mi:project-asks:${slug}`;
const CATEGORIES: [string, ScheduleType][] = [["Milestone", "Deadline"], ["Client meeting", "Client Meeting"], ["Meeting", "Meeting"], ["Work session", "Work Session"]];

type Change = { plannedDate?: string; actualDate?: string | null; type?: ScheduleType };

function question(ask: ProjectAsk): string {
  if (ask.kind === "overdue") return "Is this done?";
  if (ask.kind === "past-event") return "Did this happen?";
  return "What kind of item is this?";
}

/** One-tap answers to what only a person knows, so nobody has to go and fill in a form. */
export function ProjectAsks({ slug, asks, initialHash, today }: {
  slug: string;
  asks: ProjectAsk[];
  initialHash: string | null;
  today: string;
}) {
  const router = useRouter();
  const [hash, setHash] = useState(initialHash);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [moving, setMoving] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");
  const [confirming, setConfirming] = useState<{ milestone: Milestone; change: Change; label: string } | null>(null);
  const [notionMissing, setNotionMissing] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DISMISSED_KEY(slug)) ?? "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe read of a per-viewer preference
      if (Array.isArray(saved)) setDismissed(saved.filter((id) => typeof id === "string"));
    } catch { /* Every question stays visible. */ }
  }, [slug]);

  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY(slug), JSON.stringify(next)); } catch { /* Back next visit. */ }
  }

  async function save(milestone: Milestone, change: Change, syncNotion: boolean) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/schedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: milestone.id,
        plannedDate: change.plannedDate ?? milestone.planned_date.slice(0, 10),
        actualDate: change.actualDate === undefined ? milestone.actual_date : change.actualDate,
        type: change.type,
        syncNotion,
        confirmed: true,
        expectedHash: hash,
      }),
    }).catch(() => null);
    setBusy(false);
    const data = response ? await response.json().catch(() => ({})) : {};
    if (typeof data.hash === "string") setHash(data.hash);
    if (!response?.ok) {
      if (data.error === "notion-row-missing") {
        setNotionMissing(true);
        setError("This item no longer exists in Notion. Nothing was changed. You can save it in Mi only.");
      } else if (data.error === "conflict") {
        setError("This schedule changed elsewhere. Reload the page and try again.");
      } else {
        setError(data.error ?? "That could not be saved.");
      }
      return;
    }
    setConfirming(null);
    setMoving(null);
    setNotionMissing(false);
    router.refresh();
  }

  /** Mi's own records save on the tap. A change that reaches Notion is confirmed first. */
  function answer(milestone: Milestone, change: Change, label: string) {
    setError("");
    if (milestone.notion_event_id) setConfirming({ milestone, change, label });
    else void save(milestone, change, false);
  }

  const open = asks.filter((ask) => !dismissed.includes(ask.id));
  if (open.length === 0) return null;
  const buttonClass = "rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-40";

  return <section aria-label="Questions from Mi" className="rounded-xl border border-accent/40 bg-accent/5 p-4">
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-medium">A question from Mi</h2>
      {open.length > 1 && <span className="text-xs text-muted-foreground">1 of {open.length}</span>}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-status-danger-foreground">{error}</p>}
    {confirming && <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3 text-sm">
      <span className="min-w-0 flex-1">{confirming.label} This also updates Notion.</span>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => { setConfirming(null); setNotionMissing(false); setError(""); }}>Cancel</button>
      {notionMissing
        ? <button type="button" disabled={busy} onClick={() => void save(confirming.milestone, confirming.change, false)} className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background">Save in Mi only</button>
        : <button type="button" disabled={busy} onClick={() => void save(confirming.milestone, confirming.change, true)} className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background">Confirm</button>}
    </div>}
    <ul className="mt-2 divide-y divide-border">
      {open.slice(0, 1).map((ask) => <li key={ask.id} className="py-2.5">
        <p className="text-sm"><span className="text-muted-foreground">{question(ask)}</span> <span className="font-medium">{ask.milestone.name}</span> <span className="text-xs text-muted-foreground">{formatDay(ask.milestone.planned_date, today)}</span></p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {ask.kind === "overdue" && <button type="button" disabled={busy} className={buttonClass} onClick={() => answer(ask.milestone, { actualDate: today }, `Mark “${ask.milestone.name}” complete today?`)}>Yes, done</button>}
          {ask.kind === "past-event" && <button type="button" disabled={busy} className={buttonClass} onClick={() => answer(ask.milestone, { actualDate: ask.milestone.planned_date.slice(0, 10) }, `Mark “${ask.milestone.name}” as having happened?`)}>Yes</button>}
          {(ask.kind === "overdue" || ask.kind === "past-event") && moving !== ask.id && <button type="button" disabled={busy} className={buttonClass} onClick={() => { setMoving(ask.id); setNewDate(""); }}>New date</button>}
          {(ask.kind === "overdue" || ask.kind === "past-event") && moving === ask.id && <form className="flex items-center gap-2" onSubmit={(event) => {
            event.preventDefault();
            if (newDate) answer(ask.milestone, { plannedDate: newDate }, `Move “${ask.milestone.name}” to ${newDate}?`);
          }}>
            <input type="date" autoFocus required aria-label="New date" value={newDate} onChange={(event) => setNewDate(event.target.value)} className="rounded-md border border-border bg-card px-2 py-1 text-sm" />
            <button type="submit" disabled={busy} className={buttonClass}>Save</button>
          </form>}
          {ask.kind === "category" && CATEGORIES.map(([label, type]) => <button key={label} type="button" disabled={busy} className={buttonClass} onClick={() => void save(ask.milestone, { type }, false)}>{label}</button>)}
          <button type="button" onClick={() => dismiss(ask.id)} className="px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground">Not now</button>
        </div>
      </li>)}
    </ul>
  </section>;
}
