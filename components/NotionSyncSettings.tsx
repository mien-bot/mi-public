"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActivityIndicator } from "@/components/UiState";
import type { NotionSyncStatus } from "@/types/electron";

const INTERVAL_OPTIONS = [5, 15, 60, 240];

export function NotionSyncSettings() {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<NotionSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ state: "success" | "error"; label: string } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Electron preload exists only after hydration
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !window.electronAPI) return;
    window.electronAPI.notionSync.status()
      .then(setStatus)
      .catch((error) => setFeedback({ state: "error", label: error instanceof Error ? error.message : String(error) }));
  }, [mounted]);

  if (!mounted || !window.electronAPI) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
        Background refresh is controlled by the Mi desktop app. This browser view cannot start or
        stop the desktop process.
      </div>
    );
  }

  const api = window.electronAPI;

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Notion snapshot refresh</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Refreshes Mi&apos;s read-only Notion snapshot while the desktop app is open. It does
            not change Notion or project files.
          </p>
        </div>
        {status && (
          <span className={`status-chip ${status.enabled ? "status-chip-success" : "status-chip-missing"}`}>
            {status.enabled ? "Running" : "Stopped"}
          </span>
        )}
      </div>

      {status ? (
        <div className="mt-4 flex flex-wrap items-end gap-3 text-sm">
          <label className="text-xs text-muted-foreground">
            Refresh interval
            <select
              value={status.intervalMinutes}
              disabled={busy}
              onChange={(event) => {
                const minutes = Number(event.target.value);
                setBusy(true);
                setFeedback(null);
                api.notionSync.setInterval(minutes)
                  .then((next) => {
                    setStatus(next);
                    setFeedback({ state: "success", label: "Refresh interval saved." });
                  })
                  .catch((error) => setFeedback({ state: "error", label: error instanceof Error ? error.message : String(error) }))
                  .finally(() => setBusy(false));
              }}
              className="mt-1 block rounded-md border border-border bg-card px-3 py-2 outline-none transition-colors focus:border-accent disabled:opacity-50"
            >
              {INTERVAL_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setFeedback(null);
              const next = status.enabled ? api.notionSync.stop() : api.notionSync.start();
              next
                .then((value) => {
                  setStatus(value);
                  setFeedback({ state: "success", label: value.enabled ? "Background refresh started." : "Background refresh stopped." });
                })
                .catch((error) => setFeedback({ state: "error", label: error instanceof Error ? error.message : String(error) }))
                .finally(() => setBusy(false));
            }}
            className="rounded-md border border-border px-4 py-2 transition-colors hover:border-accent disabled:opacity-50"
          >
            {busy ? <ActivityIndicator label="Updating…" /> : status.enabled ? "Stop refresh" : "Start refresh"}
          </button>
        </div>
      ) : (
        <ActivityIndicator label="Loading refresh status…" className="mt-4 text-sm" />
      )}
      {feedback && <ActivityIndicator state={feedback.state} label={feedback.label} className="mt-3 text-sm" />}
      <div className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
        To review and bring allowlisted project fields into Mi, use{" "}
        <Link href="/projects" className="text-foreground underline underline-offset-2">
          Sync all linked projects
        </Link>
        . That workflow previews changes before confirmation.
      </div>
    </div>
  );
}
