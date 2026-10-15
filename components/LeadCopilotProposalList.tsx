"use client";

import { useRouter } from "next/navigation";
import { ProposalCardList, type ProposalListItem } from "@/components/ProposalBatch";
import { type ProposalAction, type ProposalDiffRow } from "@/components/ProposalReview";
import { formatHoursAndMinutes } from "@/lib/duration";
import type { LeadCopilotProposal } from "@/lib/leadCopilot";
import { meetingAgendaMinutes } from "@/lib/meetingAgenda";
import { formatMeetingTimeRange } from "@/lib/meetingTime";

function summary(proposal: LeadCopilotProposal): string {
  if (proposal.kind === "lead-update") return `${Object.keys(proposal.data).length} lead field(s)`;
  if (proposal.kind === "firm-memory-note") return "Shared leads playbook";
  const agendaMinutes = meetingAgendaMinutes(proposal.data.agenda_items);
  return `${proposal.data.meeting_status === "planned" ? "Planned" : "Completed"} · ${proposal.data.date} · ${formatMeetingTimeRange(proposal.data.start_time, proposal.data.end_time)} · ${agendaMinutes > 0 ? `${formatHoursAndMinutes(agendaMinutes / 60)} agenda` : "No timeboxed agenda"}`;
}

function diffRows(proposal: LeadCopilotProposal): ProposalDiffRow[] {
  if (proposal.kind === "lead-update") {
    return Object.entries(proposal.data).map(([key, value]) => ({
      label: key.replaceAll("_", " "),
      from: "",
      to: value === null ? "Blank" : String(value),
    }));
  }
  if (proposal.kind === "firm-memory-note") {
    return [{ label: "Note", from: "", to: proposal.data.entry }];
  }
  return [
    { label: "Meeting", from: "", to: proposal.data.title },
    { label: "State", from: "", to: proposal.data.meeting_status === "planned" ? "Planned agenda" : "Completed notes" },
    { label: "When", from: "", to: `${proposal.data.date} · ${formatMeetingTimeRange(proposal.data.start_time, proposal.data.end_time)} · ${proposal.data.timezone}` },
    { label: "Attendees", from: "", to: proposal.data.attendees.join(", ") || "Unconfirmed" },
    { label: "Objective", from: "", to: proposal.data.objective || "Not recorded" },
    { label: "Preparation", from: "", to: proposal.data.preparation.join("; ") || "None" },
    { label: "Agenda", from: "", to: proposal.data.agenda_items.map((item) => `${item.duration_minutes} min — ${item.topic}${item.desired_outcome ? ` (${item.desired_outcome})` : ""}`).join("; ") || "None" },
    { label: "Summary", from: "", to: proposal.data.summary || "Blank" },
    { label: "Decisions", from: "", to: proposal.data.decisions.join("; ") || "None" },
    { label: "Action items", from: "", to: proposal.data.action_items.map((item) => item.description).join("; ") || "None" },
    { label: "Raw notes", from: "", to: proposal.data.raw_notes || "Blank" },
  ];
}

export function LeadCopilotProposalList({
  leadSlug,
  notionLinked,
  proposals,
}: {
  leadSlug: string;
  notionLinked: boolean;
  proposals: LeadCopilotProposal[];
}) {
  const router = useRouter();

  async function apply(proposal: LeadCopilotProposal, destination: "mi" | "notion"): Promise<{ ok: boolean; message: string }> {
    const response = await fetch(`/api/leads/${encodeURIComponent(leadSlug)}/copilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal, confirmed: true, destination }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The confirmed lead change could not be applied.");
    const failed = body.result?.notion?.status === "failed";
    router.refresh();
    return {
      ok: !failed,
      message: failed
        ? `Saved in Mi, but Notion needs review: ${body.result.notion.error}`
        : destination === "notion"
          ? "Confirmed and saved in Mi and the linked Notion lead page."
          : "Confirmed and saved in this lead's Mi workspace.",
    };
  }

  async function applyFirmMemory(proposal: LeadCopilotProposal): Promise<{ ok: boolean; message: string }> {
    const response = await fetch("/api/leads/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal, confirmed: true }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The note could not be saved.");
    router.refresh();
    return { ok: true, message: typeof body.message === "string" ? body.message : "Saved to the shared leads playbook." };
  }

  const items: ProposalListItem[] = proposals.map((proposal) => {
    const actions: ProposalAction[] = proposal.kind === "firm-memory-note"
      ? [{ key: "confirm", label: "Confirm", primary: true, run: () => applyFirmMemory(proposal) }]
      : [
          { key: "mi", label: "Confirm Mi only", run: () => apply(proposal, "mi") },
          {
            key: "notion",
            label: "Confirm Mi + Notion",
            primary: true,
            disabled: !notionLinked,
            disabledReason: "Link this exact lead to Notion first.",
            run: () => apply(proposal, "notion"),
          },
        ];
    return {
      id: proposal.id,
      kindLabel:
        proposal.kind === "lead-meeting"
          ? proposal.data.meeting_status === "planned" ? "Lead meeting plan" : "Lead meeting notes"
          : proposal.kind === "firm-memory-note"
            ? "Firm knowledge"
            : "Lead information",
      title: proposal.title,
      summary: summary(proposal),
      reason: proposal.reason,
      diffRows: diffRows(proposal),
      actions,
      extraFields: proposal.kind !== "firm-memory-note" && !notionLinked ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Link this exact lead to Notion before confirming an external write.
        </p>
      ) : undefined,
    };
  });

  return <ProposalCardList items={items} />;
}
