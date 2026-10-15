"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectStatus } from "@/lib/schema";

const STATUS_OPTIONS: Array<{ value: ProjectStatus; label: string }> = [
  { value: "not-started", label: "Not Started" },
  { value: "in-progress", label: "In Progress" },
  { value: "complete", label: "Complete" },
  { value: "abandoned", label: "Abandoned" },
];

export function ProjectStatusControl({
  slug,
  initialStatus,
  notionLinked,
}: {
  slug: string;
  initialStatus: ProjectStatus;
  notionLinked: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [pendingStatus, setPendingStatus] = useState<ProjectStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function confirmSave() {
    if (!pendingStatus) return;
    const nextStatus = pendingStatus;
    setSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, confirmed: true }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not update project status.");
      setStatus(nextStatus);
      setPendingStatus(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update project status.");
    } finally {
      setSaving(false);
    }
  }

  const statusLabel = (value: ProjectStatus) => STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor={`project-status-${slug}`} className="text-muted-foreground">
        Project status
      </label>
      <select
        id={`project-status-${slug}`}
        value={pendingStatus ?? status}
        disabled={saving || !notionLinked}
        onChange={(event) => setPendingStatus(event.target.value as ProjectStatus)}
        className="rounded-md border border-border bg-card px-2.5 py-1.5 outline-none transition-colors focus:border-accent disabled:opacity-60"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">
        {saving
          ? "Syncing with Notion…"
          : notionLinked
            ? "Reviewed status changes sync with Notion"
            : "Link this project to Notion before changing status"}
      </span>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      {pendingStatus && pendingStatus !== status && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-lg border border-border bg-card p-5">
            <h2 className="font-medium">Confirm project status change</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Status will change from &#8220;{statusLabel(status)}&#8221; to &#8220;{statusLabel(pendingStatus)}&#8221; in Mi and in Notion.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingStatus(null)}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void confirmSave()}
                className="rounded-md bg-foreground px-3 py-2 text-sm text-background"
              >
                {saving ? "Saving…" : "Confirm and apply"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
