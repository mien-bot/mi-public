"use client";

import { useState } from "react";
import { MiMark } from "@/components/MiMark";
import { ProposalCardList } from "@/components/ProposalBatch";
import { type ProposalDiffRow } from "@/components/ProposalReview";
import { formatNotionTimestamp } from "@/lib/content/timezone";
import { parseScheduleCopilotReply, scheduleCopilotEnvelopeSchema, type ScheduleCopilotProposal } from "@/lib/scheduleCopilot";
import { readJsonResponse } from "@/lib/readJsonResponse";
import type { AgentEngine } from "@/types/electron";
import { usePersonalTimezone } from "./usePersonalTimezone";

function diffRowsFor(proposal: ScheduleCopilotProposal, timezone: string): ProposalDiffRow[] {
  if (proposal.kind === "schedule-remove") return [
    { label: "Event", from: proposal.data.name, to: "Move to Notion Trash" },
    { label: "Notion page", from: proposal.data.eventPageId, to: "Recoverable from Trash" },
  ];
  if (proposal.kind === "schedule-reschedule") {
    const displayTime = (value: string | null) => value ? formatNotionTimestamp(value, timezone) : "Not set";
    return [
      { label: "Date", from: proposal.data.currentDate, to: proposal.data.newDate },
      ...(proposal.data.currentStartTime !== proposal.data.newStartTime ? [{
        label: "Date start",
        from: displayTime(proposal.data.currentStartTime),
        to: displayTime(proposal.data.newStartTime),
      }] : []),
      ...(proposal.data.currentEndTime !== proposal.data.newEndTime ? [{
        label: "Date end",
        from: displayTime(proposal.data.currentEndTime),
        to: displayTime(proposal.data.newEndTime),
      }] : []),
    ];
  }
  if (proposal.kind === "schedule-status") {
    return [{ label: "Status", from: proposal.data.currentStatus, to: proposal.data.newStatus }];
  }
  if (proposal.kind === "schedule-duplicate") {
    return [
      { label: "Event", from: proposal.data.name, to: `${proposal.data.name} (new copy)` },
      { label: "Date", from: proposal.data.currentDate, to: proposal.data.newDate },
    ];
  }
  const displayTime = (value: string | null) => value
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value))
    : "Not set";
  return [
    { label: "Name", from: "", to: proposal.data.name },
    { label: "Date", from: "", to: proposal.data.date },
    { label: "Type", from: "", to: proposal.data.type },
    { label: "Date start", from: "", to: displayTime(proposal.data.startTime) },
    { label: "Date end", from: "", to: displayTime(proposal.data.endTime) },
    { label: "Project", from: "", to: proposal.data.projectName ?? "Firm-wide (no project)" },
  ];
}

function kindLabelFor(proposal: ScheduleCopilotProposal): string {
  if (proposal.kind === "schedule-remove") return "Remove event";
  if (proposal.kind === "schedule-reschedule") return "Reschedule";
  if (proposal.kind === "schedule-status") return "Status change";
  if (proposal.kind === "schedule-duplicate") return "Duplicate";
  return "New entry";
}

/**
 * The literal "field to input text and adjust the schedules" -- single-shot (no
 * conversation history), scoped to the read-only "schedule" firm agent persona
 * (electron/firmScopedAgentContext.js), which proposes a date/status change on an
 * existing entry or a brand-new entry (optionally linked to a confirmed project).
 * Nothing reaches Notion until the resulting ProposalCard is confirmed.
 */
export function ScheduleAdjustAgent({ onApplied }: { onApplied?: () => boolean | void | Promise<boolean | void> }) {
  const { timezone } = usePersonalTimezone();
  const [input, setInput] = useState("");
  const [engine, setEngine] = useState<AgentEngine>("codex");
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [proposals, setProposals] = useState<ScheduleCopilotProposal[]>([]);
  const [error, setError] = useState("");

  async function importProposals(file?: File) {
    if (!file || busy) return;
    setError("");
    setProposals([]);
    try {
      if (file.size > 256_000) throw new Error("Proposal files must be smaller than 256 KB.");
      const parsed = scheduleCopilotEnvelopeSchema.parse(JSON.parse(await file.text()));
      setReply("Terminal drafts loaded. Review each event and confirm only the changes you want.");
      setProposals(parsed.proposals);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid schedule proposal file.");
    }
  }

  function cancel() {
    if (requestId) window.electronAPI?.agent.cancel(requestId);
    setBusy(false);
    setRequestId(null);
  }

  async function submit() {
    const prompt = input.trim();
    const api = window.electronAPI;
    if (!prompt || !api || busy) return;
    const id = crypto.randomUUID();
    setRequestId(id);
    setBusy(true);
    setError("");
    setReply("");
    setProposals([]);
    try {
      const result = await api.agent.send({
        requestId: id,
        engine,
        model: null,
        cwd: ".",
        prompt,
        sessionId: null,
        scope: "schedule",
      });
      if (result.isError) {
        setError(result.fullOutput || "The local CLI exited without an error message.");
      } else {
        const parsed = parseScheduleCopilotReply(result.fullOutput);
        setReply(parsed.text);
        setProposals(parsed.proposals);
        if (parsed.proposalError) setError(parsed.proposalError);
      }
      setInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mi could not reach the local CLI.");
    } finally {
      setBusy(false);
      setRequestId(null);
    }
  }

  function applyProposal(proposal: ScheduleCopilotProposal) {
    return async (): Promise<{ ok: boolean; message: string }> => {
      const response = await fetch("/api/schedule/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal, confirmed: true }),
      });
      const body = await readJsonResponse<{ message?: string }>(
        response,
        "The confirmed change could not be applied.",
      );
      await Promise.resolve(onApplied?.());
      return { ok: true, message: typeof body.message === "string" ? body.message : "Confirmed." };
    };
  }

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <h3 className="text-sm font-medium">Adjust, add, or remove schedule events</h3>
      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:border-accent">
        Review terminal proposal file
        <input type="file" accept="application/json,.json" className="sr-only" disabled={busy} onChange={(event) => { void importProposals(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        Tell Mi what to change or add — e.g. &quot;move the Riya meeting to next Friday&quot;, &quot;mark the sitework milestone done&quot;, or &quot;add a client meeting for Example next Tuesday&quot;. Mi drafts the change; nothing is saved until you confirm.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="mt-3 flex flex-col gap-2 sm:flex-row"
      >
        <select
          aria-label="Schedule AI provider"
          value={engine}
          onChange={(event) => setEngine(event.target.value as AgentEngine)}
          disabled={busy}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm disabled:opacity-50"
        >
          <option value="codex">Codex</option>
          <option value="claude">Claude</option>
        </select>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder="Move the Riya meeting to next Friday…"
          disabled={busy}
          className="min-w-0 flex-1 resize-none rounded-md border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-accent disabled:opacity-50"
        />
        {busy ? (
          <button
            type="button"
            onClick={cancel}
            aria-label="Stop generating"
            title="Stop generating"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
          >
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-current" />
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground disabled:opacity-50"
          >
            Ask Mi
          </button>
        )}
      </form>

      {busy && (
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground" aria-label="Mi is thinking">
          <MiMark gradient className="h-4 w-4 animate-mark-loading" />
          Mi is thinking
        </p>
      )}
      {!busy && reply && <p className="mt-3 text-sm">{reply}</p>}
      {error && <p className="mt-3 text-xs text-status-danger-foreground">{error}</p>}
      <ProposalCardList
        items={proposals.map((proposal) => ({
          id: proposal.id,
          kindLabel: kindLabelFor(proposal),
          title: proposal.title,
          reason: proposal.reason,
          diffRows: diffRowsFor(proposal, timezone),
          defaultExpanded: true,
          actions: [{ key: "confirm", label: "Confirm in Notion", primary: true, run: applyProposal(proposal) }],
        }))}
      />
    </div>
  );
}
