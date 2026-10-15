"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CompanionSuggestion } from "@/lib/miniMi/suggestions";
import { useCompanionInbox } from "@/lib/miniMi/inbox";

const KEY = "mi-companion-suggestion-dismissals-v1";
const EVENT = "mi-companion-suggestion-dismissed";
function snapshot() { try { return localStorage.getItem(KEY) ?? "{}"; } catch { return "{}"; } }
function subscribe(fn: () => void) { window.addEventListener(EVENT,fn); window.addEventListener("storage",fn); return () => { window.removeEventListener(EVENT,fn); window.removeEventListener("storage",fn); }; }
function readDismissals(raw: string): Record<string, number> {
  try { const v = JSON.parse(raw); if (!v || typeof v !== "object" || Array.isArray(v)) return {}; return Object.fromEntries(Object.entries(v).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))); } catch { return {}; }
}

export function MiniMiSuggestions({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const projectMatch = /^\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/.exec(pathname)?.[1];
  const project = projectMatch && !["new","analysis"].includes(projectMatch) ? projectMatch : undefined;
  const match = /^\/(projects|leads|permit-qaqc)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/.exec(pathname);
  const [remote, setRemote] = useState<{ project: string; items: CompanionSuggestion[]; warning?: string | null; checkedAt: number } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(0);
  const [error, setError] = useState(false);
  const inbox = useCompanionInbox();
  const dismissals = readDismissals(useSyncExternalStore(subscribe, snapshot, () => "{}"));
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick,0); const timer = setInterval(tick,30000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!project || ["new","analysis"].includes(project)) return;
    const controller = new AbortController();
    const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    void fetch(`/api/mini-mi/suggestions?project=${encodeURIComponent(project)}&today=${today}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw Error(); return response.json(); })
      .then(data => { if (!controller.signal.aborted) setRemote({ project, items: data.items, warning: data.warning, checkedAt: data.checkedAt }); })
      .catch(() => { if (!controller.signal.aborted) setRemote({ project, items: [], warning: "Project suggestions could not be refreshed.", checkedAt: 0 }); });
    return () => controller.abort();
  }, [project, refresh]);
  const items: CompanionSuggestion[] = remote && remote.project === project ? [...remote.items] : [];
  if (!pathname.startsWith("/personal") && inbox.checkedAt && now - inbox.checkedAt < 120000) {
    const entries = match ? inbox.entries.filter(entry => entry.kind === (match[1] === "projects" ? "project" : match[1] === "leads" ? "lead" : "permit-qaqc") && entry.slug === match[2]) : inbox.entries;
    const count = entries.reduce((sum, entry) => sum + entry.pending + entry.failed, 0);
    if (count > 0) items.unshift({ id: `review:${match?.slice(1).join("/") ?? "studio"}:${count}`, title: `${count} item${count === 1 ? "" : "s"} awaiting review`, detail: "From the current review inbox snapshot. Open it to check drafts and failed imports.", href: match ? `/review?workspace=${encodeURIComponent(`${match[1] === "projects" ? "project" : match[1] === "leads" ? "lead" : "permit-qaqc"}/${match[2]}`)}` : "/review" });
  }
  const visible = items.filter(item => !(dismissals[item.id] > now)).slice(0,3);
  function dismiss(id: string, until: number) {
    try {
      const next = { ...readDismissals(snapshot()), [id]: until };
      localStorage.setItem(KEY,JSON.stringify(Object.fromEntries(Object.entries(next).slice(-200)))); window.dispatchEvent(new Event(EVENT)); setError(false);
    } catch { setError(true); }
  }
  if (!visible.length && !project) return null;
  return <section className="border-b border-border p-4" aria-label="Suggestions from saved records">
    <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-medium">From your saved records</h3>{project && <button type="button" className="text-xs text-link" onClick={() => setRefresh(v => v + 1)}>Refresh suggestions</button>}</div>
    {remote && remote.project === project && remote.warning && <p className="mt-2 text-xs text-muted-foreground">{remote.warning}</p>}
    {!visible.length && <p className="mt-2 text-xs text-muted-foreground">{project && remote?.project !== project ? "Checking saved project records…" : "No new suggestions to show. Your page shortcuts are below."}</p>}
    {visible.map(item => <div key={item.id} className="mt-3 text-xs"><Link onClick={onNavigate} href={item.href} className="font-medium text-link">{item.title}</Link><p className="mt-1 leading-5 text-muted-foreground">{item.detail}</p><div className="mt-1 flex gap-3"><button type="button" onClick={() => dismiss(item.id, Number.MAX_SAFE_INTEGER)} aria-label={`Dismiss ${item.title}`}>Dismiss</button><button type="button" onClick={() => dismiss(item.id, Date.now()+3600000)} aria-label={`Snooze ${item.title}`}>Snooze 1 hour</button></div></div>)}
    {project && <p className="mt-2 text-[10px] text-muted-foreground">Saved Mi records, not a live Notion check. Refresh after changes.</p>}
    {error && <p role="alert" className="mt-2 text-xs">This suggestion preference could not be saved.</p>}
  </section>;
}
