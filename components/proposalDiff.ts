import type { ProposalDiffRow } from "@/components/ProposalReview";
import type { ProjectCopilotProposal } from "@/lib/projectCopilot";
import { formatHoursAndMinutes } from "@/lib/duration";
import { meetingAgendaMinutes } from "@/lib/meetingAgenda";
import { formatMeetingTimeRange } from "@/lib/meetingTime";
import type { ProjectDetails, ProjectMetaPatch } from "@/lib/schema";

/**
 * What the project already has on file, so a patch-shaped proposal can be shown
 * as before → after instead of a bare list of new values. Optional throughout:
 * root chat has no single project in scope, and an unknown current value simply
 * renders as a plain "to" row the way it always did.
 */
export interface CurrentProjectValues {
  details?: ProjectDetails | null;
  meta?: ProjectMetaPatch | null;
}

export function proposalSummary(proposal: ProjectCopilotProposal): string {
  switch (proposal.kind) {
    case "project-details":
      return `${Object.keys(proposal.data).length} project field(s)`;
    case "meeting-note": {
      const agendaMinutes = meetingAgendaMinutes(proposal.data.agenda_items);
      return `${proposal.data.meeting_status === "planned" ? "Planned" : "Completed"} · ${proposal.data.date} · ${formatMeetingTimeRange(proposal.data.start_time, proposal.data.end_time)} · ${agendaMinutes > 0 ? `${formatHoursAndMinutes(agendaMinutes / 60)} agenda` : "No timeboxed agenda"}`;
    }
    case "schedule-item":
      return `${proposal.data.date} · ${proposal.data.type}`;
    case "time-entry":
      return `${proposal.data.date} · ${proposal.data.hours} hour(s) per attendee · ${proposal.data.attendees.join(", ")}`;
    case "deliverable":
      return `${proposal.data.issued_date ?? "date not confirmed"} · ${proposal.data.kind} · ${proposal.data.status}`;
    case "memory-note":
      return `${proposal.data.entry.length} character(s) added to project memory`;
    case "review-finding":
      return `${proposal.data.discipline} · ${proposal.data.status}`;
    case "decision-record":
      return `${proposal.data.decision_date} · proposal · ${proposal.data.sources.length} source(s)`;
    case "site-report":
      return `${proposal.data.visit_date} · ${proposal.data.items.length} categorized item(s) · professional review required`;
    case "project-meta":
      return `${Object.keys(proposal.data).length} project setting(s)`;
  }
}

/**
 * Renders a stored or proposed field value for the diff. Empty array / null / ""
 * all collapse to "" so that "this field is being emptied" is detectable by the
 * caller rather than showing up as a cosmetic `[]` → `[]` row.
 */
export function fieldValueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return value
      .map((entry) =>
        entry && typeof entry === "object"
          ? Object.values(entry as Record<string, unknown>).filter(Boolean).join(" — ")
          : String(entry),
      )
      .join("; ");
  }
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

/**
 * Builds a before → after row for one key of a patch-shaped proposal. A row whose
 * value is going from something to nothing is flagged, because that is the shape
 * of the apply that silently blanked three real project fields before patch
 * payloads stopped being expanded to full records (see lib/zodPatch.ts).
 */
export function patchDiffRow(key: string, current: unknown, proposed: unknown): ProposalDiffRow {
  const from = fieldValueText(current);
  const to = fieldValueText(proposed);
  const clears = from !== "" && to === "";
  const unchanged = from === to;
  return {
    label: key.replaceAll("_", " "),
    from,
    to,
    badge: clears
      ? { text: "Clears this field", tone: "danger" }
      : unchanged
        ? { text: "Unchanged", tone: "muted" }
        : undefined,
  };
}

export function diffRows(proposal: ProjectCopilotProposal, current: CurrentProjectValues): ProposalDiffRow[] {
  const to = (value: string) => ({ from: "", to: value });
  switch (proposal.kind) {
    case "project-details":
      return Object.entries(proposal.data).map(([key, value]) =>
        patchDiffRow(key, current.details?.[key as keyof ProjectDetails], value),
      );
    case "meeting-note":
      return [
        { label: "Meeting", ...to(proposal.data.title) },
        { label: "State", ...to(proposal.data.meeting_status === "planned" ? "Planned agenda" : "Completed notes") },
        { label: "When", ...to(`${proposal.data.date} · ${formatMeetingTimeRange(proposal.data.start_time, proposal.data.end_time)} · ${proposal.data.timezone}`) },
        { label: "Attendees", ...to(proposal.data.attendees.join(", ") || "Unconfirmed") },
        { label: "Objective", ...to(proposal.data.objective || "Not recorded") },
        { label: "Preparation", ...to(proposal.data.preparation.join("; ") || "None") },
        { label: "Agenda", ...to(proposal.data.agenda_items.map((item) => `${item.duration_minutes} min — ${item.topic}${item.desired_outcome ? ` (${item.desired_outcome})` : ""}`).join("; ") || "None") },
        { label: "Summary", ...to(proposal.data.summary || "Blank") },
        { label: "Decisions", ...to(proposal.data.decisions.join("; ") || "None") },
        { label: "Action items", ...to(proposal.data.action_items.map((item) => item.description).join("; ") || "None") },
      ];
    case "schedule-item":
      return [
        { label: "Item", ...to(proposal.data.name) },
        { label: "Date", ...to(proposal.data.date) },
        { label: "Type", ...to(proposal.data.type) },
        { label: "Start", ...to(proposal.data.start_time ?? "Not set") },
        { label: "End", ...to(proposal.data.end_time ?? "Not set") },
      ];
    case "time-entry":
      return [
        { label: "Work", ...to(proposal.data.name) },
        { label: "Date", ...to(proposal.data.date) },
        { label: "Hours per attendee", ...to(String(proposal.data.hours)) },
        { label: "Attendance", ...to(proposal.data.attendees.join(", ")) },
        { label: "Notes", ...to(proposal.data.notes || "None") },
      ];
    case "deliverable":
      return [
        { label: "Package", ...to(proposal.data.title) },
        { label: "Kind", ...to(proposal.data.kind) },
        { label: "Issued", ...to(proposal.data.issued_date ?? "Date not confirmed") },
        { label: "Audience", ...to(proposal.data.audience || "Unconfirmed") },
        { label: "Spaces", ...to(proposal.data.spaces.join(", ") || "None recorded") },
        { label: "Status", ...to(proposal.data.status) },
        { label: "Superseded by", ...to(proposal.data.superseded_by ?? "Not superseded") },
        // Stated on the card so the reviewer knows the folder link is still theirs to make.
        { label: "Package folder", ...to("Not linked — attach it in Mi after confirming") },
      ];
    case "memory-note":
      return [
        { label: "Heading", ...to(proposal.title) },
        { label: "Entry", ...to(proposal.data.entry) },
      ];
    case "review-finding":
      return [
        { label: "Title", ...to(proposal.title) },
        { label: "Discipline", ...to(proposal.data.discipline) },
        { label: "Status", ...to(proposal.data.status) },
        { label: "Finding", ...to(proposal.data.finding) },
        { label: "Recommendation", ...to(proposal.data.recommendation || "None recorded") },
        { label: "Related markups", ...to(proposal.data.related_markups.join(", ") || "None") },
        { label: "Related code sections", ...to(proposal.data.related_code_sections.join(", ") || "None") },
      ];
    case "decision-record":
      return [
        { label: "Title", ...to(proposal.data.title) },
        { label: "Date", ...to(proposal.data.decision_date) },
        { label: "State", ...to("Proposal — not a confirmed decision") },
        { label: "Context", ...to(proposal.data.context || "None recorded") },
        { label: "Proposed outcome", ...to(proposal.data.outcome || "None recorded") },
        { label: "Rationale", ...to(proposal.data.rationale || "None recorded") },
        { label: "Sources", ...to(proposal.data.sources.map((source) => `${source.label}${source.path ? ` — ${source.path}` : ""}`).join("; ")) },
      ];
    case "site-report":
      return [
        { label: "Title", ...to(proposal.data.title) },
        { label: "Visit date", ...to(proposal.data.visit_date) },
        { label: "State", ...to("AI-assisted draft — professional review required") },
        { label: "Purpose", ...to(proposal.data.purpose || "None recorded") },
        { label: "Scope", ...to(proposal.data.scope || "None recorded") },
        { label: "Items", ...to(proposal.data.items.map((item) => `${item.id} ${item.kind}: ${item.text}`).join("; ") || "None") },
        { label: "Photo references", ...to(proposal.data.items.flatMap((item) => item.photo_refs.map((photo) => photo.path ?? photo.label)).join("; ") || "None") },
      ];
    case "project-meta":
      return Object.entries(proposal.data).map(([key, value]) =>
        patchDiffRow(key, current.meta?.[key as keyof ProjectMetaPatch], value),
      );
  }
}
