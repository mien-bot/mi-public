"use client";
import { useState } from "react";
import type { ProjectDiscovery } from "@/lib/content/projectDiscoveryTypes";
import type { SearchEntry } from "@/lib/content/searchIndex";
import { SearchBrowser } from "./SearchBrowser";
export function ProjectFileSearch({ projects }: { projects: Array<{ slug: string; name: string }> }) {
  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Search project filenames, paths, and shared handoff summaries across projects.");
  async function load() {
    setBusy(true); let failed = 0; const next: SearchEntry[] = [];
    for (const project of projects) {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/discovery`);
        if (!response.ok) throw Error("Unavailable");
        const data: ProjectDiscovery = await response.json();
        if (!data.complete) failed++;
        next.push(...data.files.map(file => ({ id: `${project.slug}:${file.id}`, type: "project-file" as const, title: file.name, subtitle: `${project.name} · ${file.path}`, href: file.href, searchText: `${project.name} ${file.name} ${file.path}` })));
        next.push(...data.handoffs.map(h => ({ id: `${project.slug}:${h.id}`, type: "handoff" as const, title: h.title, subtitle: project.name, href: `/projects/${project.slug}/activity#${h.id}`, searchText: `${project.name} ${h.title} ${h.summary} ${h.nextSteps} ${h.openQuestions}` })));
      } catch { failed++; }
    }
    setEntries(next); setMessage(`${next.length} file and handoff entries loaded.${failed ? ` ${failed} project scan(s) incomplete or unavailable.` : ""} Document body text is not indexed.`); setBusy(false);
  }
  return <section className="space-y-3 rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">Files &amp; shared work</h2><button disabled={busy} onClick={() => void load()} className="rounded border border-border px-3 py-2 text-sm">{busy ? "Loading project files…" : "Load project file search"}</button></div><p role="status" className="text-sm text-muted-foreground">{message}</p>{entries.length > 0 && <SearchBrowser entries={entries} />}</section>;
}
