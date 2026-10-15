"use client";
import { useState } from "react";
import { DISCOVERY_CHANGED } from "./useProjectDiscovery";

export function ProjectPdfSave({ slug, suppliedFile }: { slug: string; suppliedFile?: File }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<{ fingerprint: string; destination: string; shared: boolean; href: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = suppliedFile ?? file;
  async function save(apply: boolean) {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      const form = new FormData(); form.set("file", selected); form.set("name", name || selected.name); form.set("action", apply ? "apply" : "preview");
      if (apply && preview) { form.set("confirmed", "true"); form.set("fingerprint", preview.fingerprint); }
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/sharing`, { method: "POST", body: form });
      const value = await response.json(); if (!response.ok) throw new Error(value.error);
      if (apply) {
        setPreview(null); setMessage(value.shared ? "Saved to the shared project folder. Dropbox cloud sync is not verified." : "Saved locally. Link a shared project folder to share with your partner.");
        window.dispatchEvent(new Event(DISCOVERY_CHANGED));
      } else setPreview(value);
    } catch (cause) { setPreview(null); setMessage(cause instanceof Error ? cause.message : "Save failed."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 rounded-lg border border-border p-3">
    <p className="text-sm font-medium">Save PDF to project</p>
    {!suppliedFile && <input aria-label="PDF to save to project" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={e => { const value = e.target.files?.[0] ?? null; setFile(value); setName(value?.name ?? ""); setPreview(null); setMessage(""); }} className="max-w-full text-sm" />}
    {selected && <label className="block text-sm">Filename<input aria-label="Project PDF filename" value={name || selected.name} disabled={busy} onChange={e => { setName(e.target.value); setPreview(null); }} className="mt-1 w-full rounded border border-border bg-background p-2" /></label>}
    <p className="text-xs text-muted-foreground">A copy goes into the project’s outputs folder. Existing files are never overwritten.</p>
    {preview ? <div className="space-y-2 rounded border border-accent p-3">
      <p className="break-all text-sm">Destination: {preview.destination}</p><p className="text-xs">{preview.shared ? "Shared folder; your partner needs Dropbox to finish syncing." : "Local to this computer."}</p>
      <button disabled={busy} onClick={() => void save(true)} className="rounded bg-accent px-3 py-2 text-sm text-accent-foreground">Confirm save to project</button>
      <button disabled={busy} onClick={() => setPreview(null)} className="ml-3 text-sm underline">Cancel</button>
    </div> : <button disabled={busy || !selected} onClick={() => void save(false)} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50">{busy ? "Preparing…" : "Review save destination"}</button>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
