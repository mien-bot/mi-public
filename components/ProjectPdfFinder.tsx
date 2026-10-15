"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectFile } from "@/lib/content/projectDiscoveryTypes";

export function ProjectPdfFinder({ slug, onChoose }: { slug: string; onChoose?: (reference: string) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded border border-border px-3 py-1.5 text-xs">Find project PDFs</button>
    {open && createPortal(<PdfDialog key={slug} slug={slug} onClose={() => setOpen(false)} onChoose={onChoose} />, document.body)}
  </>;
}

function PdfDialog({ slug, onClose, onChoose }: { slug: string; onClose: () => void; onChoose?: (reference: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/projects/${encodeURIComponent(slug)}/pdfs`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error); return data; })
      .then(data => { if (!controller.signal.aborted) { setFiles(data.files); setWarnings(data.warnings); setStatus(""); } })
      .catch(error => { if (!controller.signal.aborted) setStatus(error.message || "PDF lookup failed."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [slug, refresh]);
  const matches = files.filter(file => `${file.name} ${file.path}`.toLowerCase().includes(query.toLowerCase()));
  return <dialog ref={dialog} onCancel={onClose} aria-label="Find project PDFs" className="m-auto max-h-[85dvh] w-[min(42rem,95vw)] rounded-xl border border-border bg-background p-4 text-foreground backdrop:bg-black/50">
    <div className="flex items-center justify-between gap-2"><h2 className="font-medium">Find project PDFs</h2><button onClick={onClose} className="rounded border border-border px-3 py-1">Close</button></div>
    <p className="my-3 text-sm text-muted-foreground">Find PDFs saved by anyone in this project’s synced folders. Search filenames and paths; newest files appear first.</p>
    <div className="flex gap-2"><input autoFocus type="search" aria-label="Search PDFs" placeholder="PDF name or folder…" value={query} onChange={e => setQuery(e.target.value)} className="min-w-0 flex-1 rounded border border-border bg-background p-2" /><button disabled={busy} onClick={() => { setBusy(true); setRefresh(n => n + 1); }} className="rounded border border-border px-3">Refresh</button></div>
    {busy && <p role="status" className="py-2 text-sm">Finding PDFs…</p>}
    {status && <p role="status" className="py-2 text-sm">{status}</p>}
    {warnings.map(w => <p key={w} className="py-2 text-sm">{w}</p>)}
    <ul className="my-3 max-h-[50dvh] divide-y divide-border overflow-auto">{matches.map(file => <li key={file.id} className="space-y-1 py-3 text-sm">
      <a className="break-all text-link underline" href={file.href} target="_blank" rel="noreferrer">{file.name}</a>
      <p className="break-all text-xs text-muted-foreground">{file.source === "dropbox" ? "Shared folder" : "Local project"} · {file.path} · {new Date(file.modifiedAt).toLocaleString()}</p>
      <button className="rounded border border-border px-2 py-1 text-xs" onClick={async () => {
        const reference = `${file.source}:${file.path}`;
        if (onChoose) { onChoose(reference); onClose(); return; }
        try { await navigator.clipboard.writeText(reference); setStatus("Reference copied. Paste it into your terminal message."); }
        catch { setStatus(`Copy this reference: ${reference}`); }
      }}>{onChoose ? "Add to message" : "Copy reference"}</button>
    </li>)}</ul>
    {!busy && !matches.length && <p className="text-sm">No matching PDFs found. Check that the file was saved to this project and has synced to this computer.</p>}
  </dialog>;
}
