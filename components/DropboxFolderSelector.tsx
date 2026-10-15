"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function DropboxFolderSelector({ slug, currentPath }: { slug: string; currentPath: string | null }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [manual, setManual] = useState(currentPath ?? "");
  const [proposed, setProposed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe Electron capability check
    setMounted(true);
  }, []);
  const desktop = mounted && Boolean(window.electronAPI?.dropbox);

  async function preview(relativePath: string) {
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/dropbox`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relativePath }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setProposed(data.proposed_path);
    setManual(data.proposed_path);
    setMessage("Proposed path validated. project.yaml has not changed.");
  }

  async function chooseNative() {
    const result = await window.electronAPI?.dropbox.pickProjectFolder();
    if (!result) return;
    if (result.error) return setMessage(result.error);
    if (result.relativePath) await preview(result.relativePath).catch((error) => setMessage(error.message));
  }

  async function apply() {
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/dropbox`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relativePath: proposed, confirmed: true }) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error);
    setConfirming(false); setMessage(`Saved normalized dropbox_path: ${data.dropbox_path}`); router.refresh();
  }

  return <section className="rounded-lg border border-border p-5"><h2 className="font-medium">Project Dropbox folder</h2><p className="mt-1 text-sm text-muted-foreground">The native picker is constrained to DROPBOX_ROOT. It proposes a normalized relative path; a second confirmation is required before project.yaml changes.</p><div className="mt-4 flex flex-wrap gap-2">{desktop && <button type="button" onClick={() => void chooseNative()} className="rounded-md border border-border px-3 py-2 text-sm">Choose folder in desktop app</button>}<input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="1.00 PROJECTS/Project Folder" className="min-w-64 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm" /><button type="button" onClick={() => void preview(manual).catch((error) => setMessage(error.message))} className="rounded-md border border-border px-3 py-2 text-sm">Validate manual relative path</button></div>{!desktop && mounted && <p className="mt-2 text-xs text-muted-foreground">Browser fallback: enter a path relative to DROPBOX_ROOT. Absolute paths and traversal are rejected.</p>}{proposed && <div className="mt-3 rounded-md border border-border p-3 text-sm"><span className="text-muted-foreground">Proposed path</span><code className="ml-2">{proposed}</code><button type="button" onClick={() => setConfirming(true)} className="ml-3 rounded-md bg-foreground px-3 py-1 text-background">Review change</button></div>}{message && <p className="mt-2 text-sm text-muted-foreground">{message}</p>}{confirming && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-border bg-card p-5"><h2 className="font-medium">Confirm Dropbox project link</h2><p className="mt-2 text-sm text-muted-foreground">Only the normalized relative path <code>{proposed}</code> will be written to project.yaml. No Dropbox file or folder will be modified.</p><div className="mt-4 flex justify-end gap-2"><button onClick={() => setConfirming(false)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button><button onClick={() => void apply()} className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Confirm path change</button></div></div></div>}</section>;
}
