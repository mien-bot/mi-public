"use client";

import { useCallback, useEffect, useState } from "react";
import { DropboxBrowser } from "./DropboxBrowser";
import type { DropboxHealth, FileReview } from "@/lib/content/dropboxHealth";

export function DropboxHealthPanel({ kind, slug }: { kind: "projects" | "leads" | "permit-qaqc"; slug: string }) {
  const [health, setHealth] = useState<DropboxHealth | null>(null);
  const [review, setReview] = useState<FileReview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const base = `/api/dropbox-health/${kind}/${encodeURIComponent(slug)}`;
  const load = useCallback(async (refresh = false, signal?: AbortSignal) => {
    try {
      const response = await fetch(`${base}?refresh=${refresh ? "1" : "0"}`, { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setHealth(result);
    } catch (error) {
      if (!signal?.aborted) {
        setMessage(error instanceof Error ? error.message : "Folder unavailable.");
        setHealth(previous => ({ state: "unavailable", checkedAt: new Date().toISOString(), lastSuccessAt: previous?.lastSuccessAt ?? null,
          elapsedMs: 0, cached: Boolean(previous), complete: false, cloudSync: "unverified", nodes: previous?.nodes ?? [], conflicts: [], recoveries: [], warnings: [] }));
      }
    }
  }, [base]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { void load(false, controller.signal); }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load]);
  async function openReview(kind: "recovery" | "conflict", path: string) {
    setBusy(true); setMessage(""); setConfirmed(false); setReview(null);
    try {
      const response = await fetch(`${base}?review=${kind}&path=${encodeURIComponent(path)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setReview(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Review unavailable."); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!review || !confirmed) return;
    setBusy(true); setMessage("");
    try {
      const { kind, path, target, currentHash, proposedHash } = review;
      const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true, kind, path, target, currentHash, proposedHash }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(result.message); setReview(null); await load(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save unavailable."); }
    finally { setConfirmed(false); setBusy(false); }
  }
  const fileApiBase = kind === "projects" ? "/api/dropbox-file" : kind === "leads" ? "/api/lead-dropbox-file" : "/api/permit-qaqc-dropbox-file";
  const button = "rounded border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50";
  return <section className="space-y-4" aria-label="Dropbox health and recovery">
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-medium">Health and recovery</h2><button className={button} disabled={busy} onClick={() => { setReview(null); setConfirmed(false); setBusy(true); void load(true).finally(() => setBusy(false)); }}>Refresh folder</button></div>
      <p role="status">{!health ? "Checking folder availability…" : health.state === "available" ? "Local folder available" : health.state === "slow" ? "Local folder is responding slowly" : health.state === "checking" ? "Folder scan still running" : "Local folder unavailable"}{health?.cached ? " · Cached listing; files may have changed" : ""}</p>
      <p className="text-sm text-muted-foreground">Dropbox cloud sync: unverified. A local save or readable folder does not confirm upload or delivery to another computer.</p>
      {health?.lastSuccessAt && <p className="text-xs text-muted-foreground">Last successful folder scan: {new Date(health.lastSuccessAt).toLocaleString()} · {health.elapsedMs} ms</p>}
      {health?.warnings.map(w => <p key={w} className="text-sm text-muted-foreground">{w}</p>)}
      {message && <p role="status" className="text-sm">{message}</p>}
      {!!health?.recoveries.length && <div><h3 className="font-medium">Pending saves</h3><ul className="space-y-2">{health.recoveries.map(item => <li key={item.path} className="flex flex-wrap items-center gap-3"><span className="break-all text-sm">{item.target}</span><button disabled={busy} className={button} onClick={() => void openReview("recovery", item.path)}>Review pending save</button></li>)}</ul></div>}
      {!!health?.conflicts.length && <div><h3 className="font-medium">Conflicting copies</h3><p className="text-sm text-muted-foreground">Compare both versions. Keeping the current version leaves both files untouched.</p><ul className="space-y-2">{health.conflicts.map(item => <li key={item.path} className="flex flex-wrap items-center gap-3"><span className="break-all text-sm">{item.path}</span><button disabled={busy} className={button} onClick={() => void openReview("conflict", item.path)}>Compare versions</button></li>)}</ul></div>}
    </div>
    {review && <div className="rounded-xl border border-border p-4 space-y-4" role="region" aria-label="Review file versions">
      <h3 className="font-medium break-all">Review: {review.target}</h3><p className="text-sm">{review.reason}</p>
      <p className="flex flex-wrap gap-4 text-sm">{(["current", "proposed"] as const).filter(side => side !== "current" || review.currentHash !== null).map(side => <a key={side} className="text-link underline" href={`${base}?review=${review.kind}&path=${encodeURIComponent(review.path)}&download=${side}`}>Download {side} version for review</a>)}</p>
      <div className="grid gap-4 md:grid-cols-2">{[["Current version", review.currentText, review.currentSize], ["Proposed version", review.proposedText, review.proposedSize]].map(([label, text, size]) => <div key={label}><h4 className="text-sm font-medium">{label} · {size} bytes</h4><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{text}</pre></div>)}</div>
      {review.canApply && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed both versions and confirm replacing this file with the proposed content.</label>}
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !confirmed || !review.canApply} onClick={() => void apply()}>Confirm replacement</button><button className={button} disabled={busy} onClick={() => { setReview(null); setConfirmed(false); }}>Keep current version</button></div>
    </div>}
    {health?.nodes.length ? <DropboxBrowser slug={slug} nodes={health.nodes} fileApiBase={fileApiBase} /> : health?.state === "available" && health.complete ? <p className="text-sm text-muted-foreground">This folder is empty.</p> : null}
  </section>;
}
