"use client";

import { useEffect, useState } from "react";
import { scheduleTypeSchema, type AiPlanResponse, type ProjectPlanningInput, type ScheduleDraftItem } from "@/lib/schema";
import { PROJECT_CHAT_OPEN_EVENT, createProjectChatOpenDetail } from "@/components/projectChatUi";

const EMPTY_INPUT: ProjectPlanningInput = {
  goals: "", requirements: "", scope: "", constraints: "", target_dates: "",
  permitting: "", deliverables: "", team_assumptions: "", notes: "",
};

const FIELDS: [keyof ProjectPlanningInput, string, string][] = [
  ["goals", "Project goals", "What should this project accomplish?"],
  ["requirements", "Features / program requirements", "Rooms, uses, systems, performance requirements…"],
  ["scope", "Scope", "Included and excluded services or work…"],
  ["constraints", "Constraints", "Budget, existing conditions, approvals, access…"],
  ["target_dates", "Target dates", "Known deadlines and desired completion dates…"],
  ["permitting", "Permitting requirements", "Jurisdiction, submissions, review assumptions…"],
  ["deliverables", "Deliverables", "Packages, drawings, models, reports…"],
  ["team_assumptions", "Team / consultant assumptions", "Internal team, consultants, client roles…"],
  ["notes", "Miscellaneous planning notes", "Anything else the planner should account for…"],
];

type EditableItem = AiPlanResponse["timeline"][number] & { id: string; selected: boolean };

export function ProjectPlanningWorkspace({ slug, notionLinked }: { slug: string; notionLinked: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [engine, setEngine] = useState<"codex" | "claude">("codex");
  const [input, setInput] = useState(EMPTY_INPUT);
  const [summary, setSummary] = useState("");
  const [items, setItems] = useState<EditableItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [localConfirmItem, setLocalConfirmItem] = useState<EditableItem | null>(null);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<{ name: string; status: string; error?: string }[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe Electron capability check
    setMounted(true);
  }, []);
  const desktop = mounted && Boolean(window.electronAPI);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (!desktop) return;
    setBusy(true); setMessage(""); setResults([]);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/ai`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "planning", engine, input }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI planning failed.");
      const draft = data.draft as AiPlanResponse;
      setSummary(draft.summary);
      setItems(draft.timeline.map((item) => ({ ...item, id: crypto.randomUUID(), selected: true })));
      setMessage("AI draft created in read-only mode. Review and edit it before selecting any Notion changes.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "AI planning failed."); }
    finally { setBusy(false); }
  }

  function selectedScheduleItems(): ScheduleDraftItem[] {
    return items.filter((item) => item.selected).map((item) => scheduleDraftFromItem(item));
  }

  function scheduleDraftFromItem(item: EditableItem): ScheduleDraftItem {
    return {
      client_request_id: item.id, name: item.name, date: item.date, type: item.type,
      start_time: null, end_time: null,
    };
  }

  async function confirmSaveLocal() {
    if (!localConfirmItem) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/schedule`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "save-local", confirmed: true, item: scheduleDraftFromItem(localConfirmItem) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setItems((current) => current.filter((entry) => entry.id !== localConfirmItem.id));
      setMessage("Milestone saved to Mi only.");
      setLocalConfirmItem(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Local save failed."); }
    finally { setBusy(false); }
  }

  async function previewSelected() {
    const selected = selectedScheduleItems();
    if (!selected.length) return setMessage("Select at least one timeline item.");
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/schedule`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "sync", confirmed: false, items: selected }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setConfirming(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Preview failed."); }
    finally { setBusy(false); }
  }

  async function confirmSync() {
    setBusy(true);
    try {
      const selected = selectedScheduleItems();
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/schedule`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "sync", confirmed: true, items: selected }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResults(data.results);
      const applied = new Set(data.results.filter((result: { status: string }) => ["success", "already-applied"].includes(result.status)).map((result: { client_request_id: string }) => result.client_request_id));
      setItems((current) => current.filter((item) => !applied.has(item.id)));
      setConfirming(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Confirmed sync failed."); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {!desktop && mounted && <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">AI project planning is available in the Mi desktop app. This browser view can display the workspace but has no local Codex/Claude backend.</div>}
      {desktop && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(PROJECT_CHAT_OPEN_EVENT, {
            detail: createProjectChatOpenDetail(slug),
          }))}
          className="rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-accent"
        >
          Discuss this project&apos;s schedule with the agent
        </button>
      )}
      <form onSubmit={generate} className="space-y-4 rounded-lg border border-border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-medium">Planning brief</h2><p className="text-sm text-muted-foreground">Generation runs read-only and returns an editable draft only.</p></div><select value={engine} onChange={(event) => setEngine(event.target.value as "codex" | "claude")} className="rounded-md border border-border bg-card px-3 py-2 text-sm"><option value="codex">Codex</option><option value="claude">Claude</option></select></div>
        <div className="grid gap-4 lg:grid-cols-2">{FIELDS.map(([key, label, placeholder]) => <label key={key} className="text-sm"><span className="font-medium">{label}</span><textarea value={input[key]} onChange={(event) => setInput((current) => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} rows={3} className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm" /></label>)}</div>
        <button disabled={!desktop || busy} className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40">{busy ? "Drafting…" : "Generate editable AI draft"}</button>
      </form>

      {(summary || items.length > 0) && <section className="rounded-lg border border-border p-5">
        <h2 className="font-medium">Draft plan preview</h2>
        <p className="mt-1 text-xs text-muted-foreground">No AI plan is written automatically. Edit each item, then either save it to Mi only or select it for STUDIO Schedule and confirm.</p>
        <label className="mt-4 block text-sm font-medium">Summary<textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 font-normal" /></label>
        <div className="mt-4 space-y-2">{items.map((item, index) => <div key={item.id} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[auto_1fr_auto_auto_auto_auto]">
          <input type="checkbox" checked={item.selected} aria-label={`Select ${item.name}`} onChange={(event) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, selected: event.target.checked } : entry))} />
          <div className="space-y-2"><input value={item.name} onChange={(event) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry))} className="w-full rounded-md border border-border bg-card px-2 py-1 text-sm" /><input value={item.rationale} onChange={(event) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, rationale: event.target.value } : entry))} placeholder="Rationale" className="w-full rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground" /></div>
          <select value={item.type} onChange={(event) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, type: event.target.value as EditableItem["type"] } : entry))} className="rounded-md border border-border bg-card px-2 py-1 text-sm">{scheduleTypeSchema.options.map((option) => <option key={option}>{option}</option>)}</select>
          <input type="date" value={item.date} onChange={(event) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, date: event.target.value } : entry))} className="rounded-md border border-border bg-card px-2 py-1 text-sm" />
          <button type="button" onClick={() => setLocalConfirmItem(item)} className="rounded-md border border-border px-2 py-1 text-xs">Save Mi-local</button>
          <button type="button" onClick={() => setItems((current) => current.filter((_, i) => i !== index))} className="text-xs text-muted-foreground">Remove</button>
        </div>)}</div>
        <button type="button" disabled={!notionLinked || busy || !items.some((item) => item.selected)} onClick={() => void previewSelected()} className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40">Preview selected Notion changes</button>
        {!notionLinked && <p className="mt-2 text-sm text-muted-foreground">Link the project to Notion to sync; Mi-local save remains available for each item above.</p>}
      </section>}

      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {results.length > 0 && <section className="rounded-lg border border-border p-4"><h3 className="font-medium">Item-by-item apply report</h3><ul className="mt-2 text-sm">{results.map((result) => <li key={`${result.name}-${result.status}`}>{result.name}: {result.status}{result.error ? ` — ${result.error}` : ""}</li>)}</ul></section>}
      {confirming && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-border bg-card p-5"><h2 className="font-medium">Confirm STUDIO Schedule synchronization</h2><p className="mt-2 text-sm text-muted-foreground">{selectedScheduleItems().length} selected draft item(s) will be created one by one with this project&apos;s exact Projects relation. No unselected item will be sent. Retrying skips prior successes.</p><ul className="mt-3 max-h-48 overflow-auto text-sm">{items.filter((item) => item.selected).map((item) => <li key={item.id}>• {item.name} — {item.date}</li>)}</ul><div className="mt-4 flex justify-end gap-2"><button onClick={() => setConfirming(false)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button><button disabled={busy} onClick={() => void confirmSync()} className="rounded-md bg-foreground px-3 py-2 text-sm text-background">{busy ? "Applying…" : "Confirm and apply"}</button></div></div></div>}
      {localConfirmItem && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-border bg-card p-5"><h2 className="font-medium">Confirm Mi-local save</h2><p className="mt-2 text-sm text-muted-foreground">&#8220;{localConfirmItem.name}&#8221; will be saved only to Mi. Notion will not change.</p><div className="mt-4 flex justify-end gap-2"><button onClick={() => setLocalConfirmItem(null)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button><button disabled={busy} onClick={() => void confirmSaveLocal()} className="rounded-md bg-foreground px-3 py-2 text-sm text-background">{busy ? "Saving…" : "Confirm and save"}</button></div></div></div>}
    </div>
  );
}
