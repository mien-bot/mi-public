"use client";

import { useState } from "react";
import { SharedDataFolderCheck } from "@/components/SharedDataFolderCheck";
import type { SharedDataCandidate, SharedDataCounts } from "@/types/electron";

const KIND_LABELS: Array<{ key: keyof SharedDataCounts; singular: string; plural: string }> = [
  { key: "projects", singular: "project", plural: "projects" },
  { key: "leads", singular: "lead", plural: "leads" },
  { key: "clients", singular: "client", plural: "clients" },
  { key: "permitQaqc", singular: "QA/QC engagement", plural: "QA/QC engagements" },
];

function summarize(counts: SharedDataCounts): string {
  const parts = KIND_LABELS.flatMap(({ key, singular, plural }) => {
    const value = counts[key];
    if (!value) return [];
    return [`${value} ${value === 1 ? singular : plural}`];
  });
  return parts.length > 0 ? parts.join(" · ") : "No records";
}

/**
 * The firm's shared Mi data folder: one folder in Dropbox that everyone points at. Choosing
 * this is what makes projects, leads, and engagements appear -- selecting a Dropbox root alone
 * leaves a packaged Mi reading its own empty local folder (electron/runtimeDataRoot.js).
 *
 * Detection proposes folders by their contents; a person still confirms which one is theirs,
 * the same discipline as dropbox_path and notion_page_id. Confirming a folder that already
 * holds records also ticks the data-source box, because in practice choosing a populated
 * folder and not using it is never what anyone means.
 */
export function SharedMiDataSetup({
  relativePath,
  enabled,
  dropboxRoot,
  busy = false,
  onChange,
}: {
  relativePath: string | null | undefined;
  enabled: boolean;
  dropboxRoot: string | null | undefined;
  busy?: boolean;
  onChange: (next: { relativePath?: string | null; enabled?: boolean }) => void;
}) {
  const [candidates, setCandidates] = useState<SharedDataCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failure, setFailure] = useState("");

  async function findFolder() {
    const api = window.electronAPI?.dropbox;
    if (!api?.findSharedData) return;
    setSearching(true);
    setFailure("");
    setCandidates(null);
    try {
      const result = await api.findSharedData();
      if (result.error) setFailure(result.error);
      setCandidates(result.candidates);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }

  async function pickFolder() {
    const api = window.electronAPI?.dropbox;
    if (!api) return;
    setFailure("");
    try {
      const result = await api.pickSharedFolder();
      if (result.error) setFailure(result.error);
      else if (result.relativePath) {
        setCandidates(null);
        onChange({ relativePath: result.relativePath });
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-4 text-sm lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Shared Mi records folder</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            relativePath
              ? "bg-status-success text-status-success-foreground"
              : "bg-status-warning text-status-warning-foreground"
          }`}
        >
          {relativePath ? "Selected" : "Required"}
        </span>
      </div>

      <code className="block break-all rounded-md bg-muted/30 p-2 text-xs">
        {relativePath || "Not selected"}
      </code>

      <p className="text-xs text-muted-foreground">
        The one folder inside STUDIO Dropbox holding projects, leads, clients, and QA/QC.
        Both partners choose this same relative folder even when their local Dropbox paths differ.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || searching || !dropboxRoot}
          onClick={() => void findFolder()}
          className="tactile-control rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
        >
          {searching ? "Looking…" : "Find shared records"}
        </button>
        <button
          type="button"
          disabled={busy || !dropboxRoot}
          onClick={() => void pickFolder()}
          className="tactile-control rounded-md border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50"
        >
          Choose manually
        </button>
        {relativePath && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setCandidates(null);
              onChange({ relativePath: null, enabled: false });
            }}
            className="tactile-control rounded-md border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50"
          >
            Clear
          </button>
        )}
      </div>

      {!dropboxRoot && (
        <p className="text-xs text-muted-foreground">Select the STUDIO Dropbox root above first.</p>
      )}
      {failure && <p role="status" className="text-xs text-status-danger-foreground">{failure}</p>}

      {candidates && candidates.length === 0 && !failure && (
        <div className="rounded-md border border-status-warning-foreground/40 bg-status-warning/30 p-3 text-xs">
          <p className="font-medium">No folder in your Dropbox holds Mi records yet.</p>
          <p className="mt-1">
            Either Dropbox hasn&apos;t finished syncing, or the firm&apos;s folder sits deeper than
            two levels down. Ask whoever set Mi up which folder to use, then choose it manually.
          </p>
        </div>
      )}

      {candidates && candidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {candidates.length === 1
              ? "Found one folder holding Mi records:"
              : `Found ${candidates.length} folders holding Mi records. Pick the firm's:`}
          </p>
          {candidates.map((candidate) => {
            const selected = candidate.relativePath === relativePath;
            return (
              <div
                key={candidate.relativePath}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-3"
              >
                <div className="min-w-0">
                  <code className="block break-all text-xs font-medium">{candidate.relativePath}</code>
                  <p className="mt-0.5 text-xs text-muted-foreground">{summarize(candidate.counts)}</p>
                </div>
                <button
                  type="button"
                  disabled={busy || selected}
                  onClick={() => onChange({ relativePath: candidate.relativePath, enabled: true })}
                  className="tactile-control rounded-md bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-50"
                >
                  {selected ? "Selected" : "Use this folder"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {relativePath && (
        <>
          <label className="flex cursor-pointer items-start gap-2.5 border-t border-border pt-3 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => onChange({ enabled: event.target.checked })}
              className="mt-0.5 accent-accent"
            />
            <span>
              <span className="block font-medium">Use these shared records on this computer</span>
              <span className="block text-xs text-muted-foreground">
                Leave this on. Turning it off makes this computer keep its own separate, empty
                set of records. Credentials and personal data always stay local either way.
              </span>
            </span>
          </label>
          <SharedDataFolderCheck relativePath={relativePath} enabled={enabled} disabled={busy} />
        </>
      )}
    </div>
  );
}
