"use client";

import { useEffect, useState } from "react";
import type { HarnessEntry } from "@/types/electron";

export function AgentWorkspaceManager({
  slug,
  kind = "project",
}: {
  slug: string;
  kind?: "project" | "permit-qaqc" | "lead";
}) {
  const [mounted, setMounted] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [entries, setEntries] = useState<HarnessEntry[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Electron preload exists only after hydration
    setMounted(true);
  }, []);

  if (!mounted) {
    return <section className="rounded-lg border border-border p-5 text-sm text-muted-foreground">Loading agent workspace…</section>;
  }

  if (!window.electronAPI) {
    return (
      <section className="rounded-lg border border-border p-5 text-sm text-muted-foreground">
        Agent workspace repair is available in the Mi desktop app.
      </section>
    );
  }

  const api = kind === "permit-qaqc"
    ? window.electronAPI.permitQaqcHarness
    : kind === "lead"
      ? window.electronAPI.leadHarness
      : window.electronAPI.harness;

  async function preview() {
    setMessage("");
    setConfirmed(false);
    try {
      const result = await api.preview(slug);
      setPreviewId(result.previewId);
      setEntries(result.entries);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function apply() {
    if (!previewId || !confirmed) return;
    try {
      const result = await api.apply(previewId, true);
      setMessage(result.results.map((item) => `${item.relativePath}: ${item.status}`).join(" · "));
      setPreviewId(null);
      setEntries([]);
      setConfirmed(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="rounded-lg border border-border p-5">
      <h2 className="font-medium">
        {kind === "permit-qaqc" ? "Permit QAQC agent workspace" : kind === "lead" ? "Lead agent workspace" : "Project agent workspace"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {kind === "permit-qaqc"
          ? "Preview a deterministic Codex/Claude workspace at the confirmed Dropbox engagement path. Previewing performs no external write."
          : kind === "lead"
            ? "Preview a deterministic Codex/Claude workspace at this lead's linked Dropbox folder, or its local Mi folder when no Dropbox folder is linked yet. Previewing performs no external write. User-authored memory is preserved. Run this before opening the lead's Terminal tab."
            : "Preview a deterministic Codex/Claude workspace at the confirmed Dropbox project path. Previewing performs no external write. User-authored memory is preserved."}
      </p>
      <button type="button" onClick={() => void preview()} className="mt-4 rounded-md border border-border px-3 py-2 text-sm">
        Repair/Refresh Agent Workspace
      </button>
      {entries.length > 0 && (
        <div className="mt-4 space-y-3">
          <ul className="space-y-1 text-sm">
            {entries.map((entry) => (
              <li key={entry.relativePath} className="flex justify-between gap-3 rounded-md border border-border px-3 py-2">
                <code className="break-all">{entry.relativePath}</code>
                <span className={entry.action === "conflict" ? "text-status-warning-foreground" : "text-muted-foreground"}>
                  {entry.action}
                </span>
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>
              I confirm the listed create/update operations. Conflicts and existing user-authored
              files will not be overwritten.
            </span>
          </label>
          <button
            type="button"
            disabled={!confirmed}
            onClick={() => void apply()}
            className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
          >
            Apply confirmed workspace changes
          </button>
        </div>
      )}
      {message && <p role="status" className="mt-3 break-words text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
