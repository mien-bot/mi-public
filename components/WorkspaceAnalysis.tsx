"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AnalysisComparison, AnalysisFinding, WorkspaceAnalysis } from "@/lib/content/workspaceAnalysis";
import type { AnalysisNudge } from "@/lib/content/workspaceAnalysisStore";
import type { WorkspaceKind } from "@/lib/content/workspaceOutbox";

const SEVERITY_LABEL: Record<AnalysisFinding["severity"], string> = {
  blocking: "Blocking",
  conflict: "Conflict",
  stale: "Stale",
  note: "Open",
};

/** What Analyze did to this workspace's generated notes, in one sentence. */
function describeKnowledge(files: { relativePath: string; status: string }[]): string {
  const has = (status: string) => files.some((file) => file.status === status);
  if (has("nothing-to-write")) {
    return "nothing captured yet, so no notes were written. They appear once a meeting is recorded or a terminal session files an entry.";
  }
  if (has("no-workspace")) {
    return "this record has no agent workspace yet. Open its Terminal once, or use Repair/Refresh Agent Workspace below, and Mi will create it.";
  }
  const conflicts = files.filter((file) => file.status === "conflict");
  if (conflicts.length > 0) {
    return `${conflicts.map((file) => file.relativePath).join(", ")} was hand-edited and left untouched.`;
  }
  const written = files.filter((file) => file.status === "written");
  return written.length === 0
    ? "already current."
    : `refreshed ${written.length} file(s) for the next terminal session.`;
}

function FindingList({ title, findings, newIds }: {
  title: string;
  findings: AnalysisFinding[];
  newIds: Set<string>;
}) {
  if (findings.length === 0) return null;
  return (
    <section className="mt-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {findings.map((finding) => (
          <li key={finding.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {SEVERITY_LABEL[finding.severity]}
              </span>
              {newIds.has(finding.id) && (
                <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-background">New</span>
              )}
              <span className="font-medium">{finding.title}</span>
            </div>
            <p className="mt-1 text-muted-foreground">{finding.detail}</p>
            {finding.evidence.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Evidence: {finding.evidence.join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Analyze surface.
 *
 * The nudge beside the button is computed on page load from Mi's bookkeeping files, so a
 * person can see whether pressing it is worth anything without paying for a full pass.
 */
export function WorkspaceAnalysisPanel({ kind, slug, initialAnalysis, nudge }: {
  kind: WorkspaceKind;
  slug: string;
  initialAnalysis: WorkspaceAnalysis | null;
  nudge: AnalysisNudge;
}) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<WorkspaceAnalysis | null>(initialAnalysis);
  const [comparison, setComparison] = useState<AnalysisComparison | null>(null);
  const [knowledge, setKnowledge] = useState<{ relativePath: string; status: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workspace-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, slug }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAnalysis(data.analysis);
      setComparison(data.comparison);
      setKnowledge(data.knowledge ?? []);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analyze failed.");
    } finally {
      setBusy(false);
    }
  }

  const newIds = new Set(comparison?.newFindings.map((finding) => finding.id) ?? []);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Analyze</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Re-reads the folder, the session outbox, and every meeting, refreshes this
            workspace&apos;s generated notes for the next terminal session, and reports where
            this stands. It proposes only — nothing is applied without a confirmed review card.
          </p>
        </div>
        <button
          type="button"
          onClick={analyze}
          disabled={busy}
          className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-60"
        >
          {busy ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {nudge.lastRanAt ? `Last analyzed ${nudge.lastRanAt.slice(0, 16).replace("T", " ")}` : "Never analyzed"}
        {nudge.reasons.length > 0 && ` · ${nudge.reasons.join(" · ")}`}
      </p>

      {error && <p className="mt-3 rounded-md border border-border p-3 text-sm">{error}</p>}

      {comparison && (
        <p className="mt-3 text-sm">
          {comparison.firstRun
            ? "First run — everything below is new."
            : comparison.unchanged
              ? "Nothing changed since the last run."
              : `${comparison.newFindings.length} new, ${comparison.resolvedFindings.length} resolved since the last run.`}
        </p>
      )}

      {knowledge.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Workspace notes: {describeKnowledge(knowledge)}</p>
      )}

      {analysis && (
        <div className="mt-3">
          <p className="text-sm"><span className="font-medium">Where this stands:</span> {analysis.standing}</p>
          <p className={`mt-1 text-xs ${analysis.folderRead ? "text-muted-foreground" : "font-medium"}`}>
            {analysis.folderNote}
          </p>

          <FindingList title="Blocking" findings={analysis.blockers} newIds={newIds} />
          <FindingList title="Contradictions" findings={analysis.contradictions} newIds={newIds} />
          <FindingList title="Stale" findings={analysis.staleness} newIds={newIds} />
          <FindingList title="Open questions" findings={analysis.openQuestions} newIds={newIds} />

          {analysis.actionItems.length > 0 && (
            <section className="mt-4">
              <h3 className="text-sm font-medium">Action items</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {analysis.actionItems.map((item) => (
                  <li key={`${item.description}-${item.sourceLabel}`} className="flex flex-wrap gap-2">
                    {item.overdue && <span className="text-xs font-medium">OVERDUE</span>}
                    <span>{item.description}</span>
                    <span className="text-muted-foreground">
                      {item.owner || "no owner"}{item.dueDate ? ` · due ${item.dueDate}` : " · no due date"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {analysis.missing.length > 0 && (
            <section className="mt-4">
              <h3 className="text-sm font-medium">Missing</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                {analysis.missing.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
