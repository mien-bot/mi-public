"use client";

import { useState } from "react";
import { ActivityIndicator } from "@/components/UiState";
import type { SharedDataCounts, SharedDataInspection } from "@/types/electron";

const KIND_LABELS: Array<{ key: keyof SharedDataCounts; label: string }> = [
  { key: "projects", label: "Projects" },
  { key: "leads", label: "Leads" },
  { key: "clients", label: "Clients" },
  { key: "permitQaqc", label: "Permit QA/QC" },
];

type Verdict = "error" | "empty" | "not-source" | "ready";

/**
 * The four states a second computer can actually be in. Only "ready" means the records in the
 * shared folder are the ones Mi is showing; "not-source" is the case that otherwise looks
 * exactly like a broken sync -- a full Dropbox folder and zero projects on screen.
 */
function verdictOf(report: SharedDataInspection): Verdict {
  if (report.error || !report.reachable) return "error";
  if (report.sharedTotal === 0) return "empty";
  return report.usingAsDataSource ? "ready" : "not-source";
}

const VERDICT_STYLE: Record<Verdict, { panel: string; dot: string }> = {
  error: { panel: "border-status-danger-foreground/40 bg-status-danger/30", dot: "bg-status-danger-foreground" },
  empty: { panel: "border-status-warning-foreground/40 bg-status-warning/30", dot: "bg-status-warning-foreground" },
  "not-source": { panel: "border-status-warning-foreground/40 bg-status-warning/30", dot: "bg-status-warning-foreground" },
  ready: { panel: "border-status-success-foreground/40 bg-status-success/30", dot: "bg-status-success-foreground" },
};

function headline(report: SharedDataInspection, verdict: Verdict): string {
  if (verdict === "error") return "This folder can't be read right now";
  if (verdict === "empty") return "Folder found, but it holds no Mi records yet";
  if (verdict === "not-source") return `Found ${report.sharedTotal} shared record(s) — this computer isn't using them yet`;
  return `Using this shared folder — ${report.sharedTotal} record(s)`;
}

/** Absent folder and empty folder are different findings; never collapse them into "0". */
function countLabel(value: number | null): string {
  return value === null ? "—" : String(value);
}

export function SharedDataFolderCheck({
  relativePath,
  enabled,
  disabled = false,
}: {
  /** The draft path, so the check can run before the setting is saved. */
  relativePath: string | null | undefined;
  enabled: boolean;
  disabled?: boolean;
}) {
  const [report, setReport] = useState<SharedDataInspection | null>(null);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState("");

  async function check() {
    const api = window.electronAPI?.dropbox;
    if (!api?.inspectSharedData) return;
    setChecking(true);
    setFailure("");
    try {
      setReport(await api.inspectSharedData(relativePath ?? null));
    } catch (error) {
      setReport(null);
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }

  const verdict = report ? verdictOf(report) : null;
  // Once the shared folder is the data source, the local root isn't read at all -- showing it
  // as a second column would invite comparing numbers that no longer compete.
  const showLocalColumn = Boolean(report && !report.usingAsDataSource);

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={disabled || checking}
        onClick={() => void check()}
        className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
      >
        {checking ? <ActivityIndicator label="Checking Dropbox folder…" /> : "Check what this folder holds"}
      </button>

      {failure && <p role="status" className="text-xs text-status-danger-foreground">{failure}</p>}

      {report && verdict && (
        <div role="status" className={`rounded-md border p-3 ${VERDICT_STYLE[verdict].panel}`}>
          <div className="flex items-start gap-2">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${VERDICT_STYLE[verdict].dot}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{headline(report, verdict)}</p>
              {report.relativePath && (
                <code className="mt-1 block break-all text-xs text-muted-foreground">{report.relativePath}</code>
              )}
            </div>
          </div>

          {report.error && <p className="mt-2 text-xs">{report.error}</p>}

          {report.shared && (
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="py-1 text-left font-normal">Record</th>
                  <th scope="col" className="py-1 text-right font-normal">Shared folder</th>
                  {showLocalColumn && (
                    <th scope="col" className="py-1 text-right font-normal">This computer</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {KIND_LABELS.map(({ key, label }) => (
                  <tr key={key} className="border-t border-border/50">
                    <th scope="row" className="py-1 text-left font-normal">{label}</th>
                    <td className="py-1 text-right font-medium tabular-nums">{countLabel(report.shared![key])}</td>
                    {showLocalColumn && (
                      <td className="py-1 text-right tabular-nums text-muted-foreground">
                        {countLabel(report.local?.[key] ?? null)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="mt-3 text-xs">
            {verdict === "not-source" && (
              <>
                Mi is still reading this computer&apos;s own local folder, which is why the
                sidebar shows {report.localTotal} project(s). Tick{" "}
                <strong>&ldquo;Use this shared folder as this computer&apos;s Mi data source&rdquo;</strong>{" "}
                below, then save — the local server restarts and the records above appear.
              </>
            )}
            {verdict === "empty" && (
              <>
                Either Dropbox hasn&apos;t finished downloading this folder yet, or this is not
                the folder holding the firm&apos;s Mi data. Nothing was created or changed.
                Confirm the exact folder with whoever set Mi up first.
              </>
            )}
            {verdict === "ready" && (
              <>
                These are the records Mi reads on this computer. Everyone pointing at the same
                Dropbox folder sees the same list, whatever their own Dropbox is named.
              </>
            )}
            {verdict === "error" && (
              <>
                Nothing was created or changed. Check that Dropbox is running and has finished
                syncing, then choose the folder again.
              </>
            )}
          </p>

          {verdict !== "error" && enabled && !report.usingAsDataSource && (
            <p className="mt-2 text-xs font-medium">
              The checkbox below is ticked but not saved yet — save to apply it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
