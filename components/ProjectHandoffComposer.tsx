"use client";
import { useState } from "react";
import type { ProjectFile } from "@/lib/content/projectDiscoveryTypes";
import { DISCOVERY_CHANGED, useProjectDiscovery } from "./useProjectDiscovery";

export function ProjectHandoffComposer({ slug, initialTitle = "", initialSummary = "", provider = "" }: { slug: string; initialTitle?: string; initialSummary?: string; provider?: string }) {
  const { data, error } = useProjectDiscovery(slug);
  const [id, setId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(initialTitle.slice(0, 160));
  const [summary, setSummary] = useState(initialSummary.slice(0, 12000));
  const [nextSteps, setNextSteps] = useState("");
  const [openQuestions, setOpenQuestions] = useState("");
  const [author, setAuthor] = useState("");
  const [selected, setSelected] = useState<ProjectFile[]>([]);
  const [preview, setPreview] = useState<{ fingerprint: string; destination: string; shared: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const draft = { id, title, summary, nextSteps, openQuestions, author, provider: ["codex", "claude", "other"].includes(provider) ? provider : "", files: selected.map(({ source, path, revision }) => ({ source, path, revision })) };
  async function submit(apply: boolean) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/sharing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: apply ? "apply" : "preview", draft, fingerprint: preview?.fingerprint, confirmed: apply }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error);
      if (apply) { const shared = preview?.shared; setPreview(null); setId(crypto.randomUUID()); setTitle(""); setSummary(""); setNextSteps(""); setOpenQuestions(""); setSelected([]); setMessage(shared ? "Handoff saved. Shared folder delivery still depends on Dropbox sync." : "Handoff saved locally on this computer."); window.dispatchEvent(new Event(DISCOVERY_CHANGED)); }
      else setPreview(value);
    } catch (cause) { setPreview(null); setMessage(cause instanceof Error ? cause.message : "Handoff failed."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-label="Share a project handoff">
    <h2 className="font-medium">Share a handoff</h2>
    <p className="text-sm text-muted-foreground">Review a summary for your partner and the next agent. Private session history is not included. Sharing records the handoff, not approval of every claim in it.</p>
    {error && <p role="alert" className="text-sm">{error}</p>}
    <fieldset disabled={busy || Boolean(preview)} className="space-y-3 disabled:opacity-75">
      <label className="block text-sm">Title<input maxLength={160} value={title} onChange={e => setTitle(e.target.value)} className="mt-1 w-full rounded border border-border bg-background p-2" /></label>
      <label className="block text-sm">Summary / completed work<textarea aria-label="Summary / completed work" maxLength={12000} rows={5} value={summary} onChange={e => setSummary(e.target.value)} className="mt-1 w-full rounded border border-border bg-background p-2" /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Next steps<textarea aria-label="Next steps" maxLength={6000} rows={3} value={nextSteps} onChange={e => setNextSteps(e.target.value)} className="mt-1 w-full rounded border border-border bg-background p-2" /></label>
      <label className="block text-sm">Open questions<textarea aria-label="Open questions" maxLength={6000} rows={3} value={openQuestions} onChange={e => setOpenQuestions(e.target.value)} className="mt-1 w-full rounded border border-border bg-background p-2" /></label></div>
      <label className="block text-sm">Your name (optional)<input maxLength={120} value={author} onChange={e => setAuthor(e.target.value)} className="mt-1 w-full rounded border border-border bg-background p-2" /></label>
      <details><summary className="cursor-pointer text-sm">Attach project files ({selected.length}/30)</summary><div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
        {(data?.files ?? []).filter(f => !data?.shared || f.source === "dropbox").map(file => <label key={file.id} className="flex items-start gap-2 break-all text-sm"><input type="checkbox" checked={selected.some(s => s.id === file.id)} disabled={selected.length >= 30 && !selected.some(s => s.id === file.id)} onChange={e => setSelected(e.target.checked ? [...selected, file] : selected.filter(s => s.id !== file.id))} />{file.path}</label>)}
      </div></details>
      <details><summary className="cursor-pointer text-sm">Import an existing handoff draft</summary><p className="mt-2 text-xs text-muted-foreground">Import a JSON draft from an agent, or paste the relevant work into Summary above. Import does not publish anything.</p>
        <input aria-label="Import handoff JSON" type="file" accept=".json" onChange={async e => {
          try { const file = e.target.files?.[0]; if (!file) return; if (file.size > 50_000) throw new Error("Choose a draft smaller than 50 KB."); const value = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
            if (typeof value.title !== "string" || typeof value.summary !== "string") throw new Error("The draft needs title and summary fields.");
            setTitle(value.title.slice(0,160)); setSummary(value.summary.slice(0,12000)); setNextSteps(String(value.nextSteps ?? "").slice(0,6000)); setOpenQuestions(String(value.openQuestions ?? "").slice(0,6000)); setSelected([]); setMessage("Draft imported. Review its text and select available project files before sharing.");
          } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Import failed."); }
        }} className="mt-2 max-w-full text-sm" />
      </details>
    </fieldset>
    {preview ? <div className="space-y-2 rounded border border-accent p-3"><p className="break-all text-sm">Save exactly the text and {selected.length} file references shown above to {preview.destination}.</p><p className="text-xs">{preview.shared ? "This publishes a handoff in the shared folder." : "This project has no shared folder; the handoff stays on this computer."}</p><button disabled={busy} onClick={() => void submit(true)} className="rounded bg-accent px-3 py-2 text-sm text-accent-foreground">Confirm handoff</button><button disabled={busy} onClick={() => setPreview(null)} className="ml-3 text-sm underline">Back to editing</button></div>
      : <button disabled={busy || !title.trim() || !summary.trim() || !data || Boolean(error)} onClick={() => void submit(false)} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50">{busy ? "Preparing…" : "Review handoff"}</button>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
