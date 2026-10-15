"use client";

import { useEffect, useRef, useState } from "react";
import {
  ProjectCopilotProposalList,
  type CurrentProjectValues,
} from "@/components/ProjectCopilotProposalList";
import { proposalKindLabel } from "@/lib/projectCopilot";
import type {
  AgentProposalInboxRecord,
  AgentProposalInboxResolution,
} from "@/lib/content/agentProposalInbox";

/** A card the person closed without applying it, plus the reason if they gave one. */
function ResolutionRow({ entry }: { entry: AgentProposalInboxResolution }) {
  const dismissed = entry.status === "dismissed";
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
      <span
        className={`rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
          dismissed
            ? "border-border text-muted-foreground"
            : "border-accent/50 text-accent"
        }`}
      >
        {dismissed ? "Dismissed" : "Applied"}
      </span>
      <span className="text-xs font-medium">{entry.proposal.title}</span>
      <span className="text-[11px] text-muted-foreground">
        {proposalKindLabel(entry.proposal.kind)} · {new Date(entry.resolvedAt).toLocaleString()}
      </span>
      {entry.reason && <span className="w-full text-[11px] italic text-muted-foreground">“{entry.reason}”</span>}
    </li>
  );
}

export function AgentProposalInbox({
  projectSlug,
  notionLinked,
  initialRecords,
  currentValues,
}: {
  projectSlug: string;
  notionLinked: boolean;
  initialRecords: AgentProposalInboxRecord[];
  /** Stored project values, so a patch card can show before → after and flag clears. */
  currentValues: CurrentProjectValues;
}) {
  const [records, setRecords] = useState(initialRecords);
  const [showHistory, setShowHistory] = useState(false);
  const [busyEnvelope, setBusyEnvelope] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The same records, readable synchronously.
   *
   * Closing a proposal rewrites its envelope, so the next close needs the hash the previous
   * one just produced. React state is not available again until the component re-renders,
   * which is fine when a person clicks one card at a time and wrong the moment several are
   * confirmed in one pass: every close after the first would send the hash from before the
   * batch started and be rejected as a change made behind the reviewer's back.
   */
  const recordsRef = useRef(initialRecords);

  function applyRecords(next: AgentProposalInboxRecord[]) {
    recordsRef.current = next;
    setRecords(next);
  }

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/agent-inbox`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = await response.json();
        if (active && Array.isArray(body.records)) applyRecords(body.records);
      } catch {
        // Dropbox may be temporarily offline. Keep the last known, validated list.
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    const onHashChange = () => {
      if (window.location.hash === "#project-agent-proposal-inbox") void refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [projectSlug]);

  if (records.length === 0) return null;

  /**
   * Closes proposals in one envelope. Applying happens elsewhere (the copilot
   * route does the write, then calls back here to close the draft); dismissing
   * is only this call, and deliberately writes nothing but the decision.
   */
  async function closeProposals(
    record: AgentProposalInboxRecord,
    proposalIds: string[],
    status: "applied" | "dismissed",
    reason = "",
  ) {
    // Read through the ref, never the captured `record`: within one batch the envelope has
    // already been rewritten by the close before this one.
    const live = recordsRef.current.find((item) => item.envelope.id === record.envelope.id) ?? record;
    const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/agent-inbox`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        envelopeId: live.envelope.id,
        proposalIds,
        status,
        reason,
        expectedHash: live.hash,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The inbox draft could not be closed.");

    const closing = new Set(proposalIds);
    const resolvedAt = new Date().toISOString();
    applyRecords(recordsRef.current.map((item) =>
      item.envelope.id === live.envelope.id
        ? {
            ...item,
            hash: body.hash,
            pendingProposals: item.pendingProposals.filter((proposal) => !closing.has(proposal.id)),
            resolvedProposals: [
              ...item.resolvedProposals,
              ...item.pendingProposals
                .filter((proposal) => closing.has(proposal.id))
                .map((proposal) => ({ proposal, status, resolvedAt, reason })),
            ],
          }
        : item,
    ));
  }

  async function dismissRemaining(record: AgentProposalInboxRecord) {
    setBusyEnvelope(record.envelope.id);
    setError(null);
    try {
      await closeProposals(
        record,
        record.pendingProposals.map((proposal) => proposal.id),
        "dismissed",
      );
    } catch (dismissError) {
      setError(dismissError instanceof Error ? dismissError.message : String(dismissError));
    } finally {
      setBusyEnvelope(null);
    }
  }

  const pendingCount = records.reduce((sum, record) => sum + record.pendingProposals.length, 0);
  const resolvedCount = records.reduce((sum, record) => sum + record.resolvedProposals.length, 0);
  const dismissedCount = records.reduce(
    (sum, record) => sum + record.resolvedProposals.filter((entry) => entry.status === "dismissed").length,
    0,
  );

  return (
    <section
      id="project-agent-proposal-inbox"
      className="scroll-mt-6 rounded-lg border border-accent/50 bg-accent/5 p-4"
      aria-labelledby="agent-inbox-heading"
    >
      <h2 id="agent-inbox-heading" className="font-medium">CLI agent proposal inbox</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {pendingCount > 0 ? (
          <>
            {pendingCount} validated draft proposal{pendingCount === 1 ? "" : "s"}{" "}
            from this project&apos;s Dropbox agent workspace. Nothing below has been applied.
          </>
        ) : (
          <>
            Nothing is waiting for review. {resolvedCount} earlier proposal
            {resolvedCount === 1 ? "" : "s"} {resolvedCount === 1 ? "was" : "were"} closed
            {dismissedCount > 0 ? ` (${dismissedCount} dismissed without applying)` : ""}.
          </>
        )}
      </p>

      {error && (
        <p className="mt-2 rounded-md border border-status-danger-foreground/50 bg-status-danger px-3 py-2 text-sm text-status-danger-foreground">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-4">
        {records
          .filter((record) => record.pendingProposals.length > 0)
          .map((record) => (
            <div key={record.envelope.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {record.envelope.source === "mi-project-terminal-file"
                    ? "Project terminal file"
                    : record.envelope.source === "mi-project-terminal"
                      ? "Project terminal output"
                      : record.envelope.engine}
                  {record.envelope.model ? ` · ${record.envelope.model}` : ""}
                  {" · "}
                  {new Date(record.envelope.created_at).toLocaleString()}
                </p>
                {record.pendingProposals.length > 1 && (
                  <button
                    type="button"
                    disabled={busyEnvelope === record.envelope.id}
                    onClick={() => void dismissRemaining(record)}
                    className="rounded-md border border-border px-2 py-1 text-xs transition-colors hover:border-accent disabled:opacity-50"
                  >
                    {busyEnvelope === record.envelope.id
                      ? "Dismissing…"
                      : `Dismiss remaining ${record.pendingProposals.length}`}
                  </button>
                )}
              </div>
              <ProjectCopilotProposalList
                projectSlug={projectSlug}
                notionLinked={notionLinked}
                proposals={record.pendingProposals}
                currentValues={currentValues}
                onProposalResolved={(proposalId) => closeProposals(record, [proposalId], "applied")}
                onProposalDismissed={(proposalId, reason) =>
                  closeProposals(record, [proposalId], "dismissed", reason)
                }
              />
            </div>
          ))}
      </div>

      {resolvedCount > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setShowHistory((value) => !value)}
            aria-expanded={showHistory}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {showHistory ? "Hide" : "Show"} {resolvedCount} closed proposal
            {resolvedCount === 1 ? "" : "s"}
          </button>
          {showHistory && (
            <ul className="mt-2 divide-y divide-border">
              {records.flatMap((record) =>
                record.resolvedProposals.map((entry) => (
                  <ResolutionRow key={`${record.envelope.id}-${entry.proposal.id}`} entry={entry} />
                )),
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
