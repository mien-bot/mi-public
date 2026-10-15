export type ReadinessState = "ready" | "attention" | "missing";

export interface ReadinessItem {
  id: string;
  label: string;
  state: ReadinessState;
  detail: string;
  href?: string;
}

export interface ProjectReadinessInput {
  dropboxLinked: boolean;
  notionLinked: boolean;
  scopeConfirmed: boolean;
  phaseCount: number;
  contractCount: number;
  primaryContractLinked: boolean;
  meetingCount: number;
  milestoneCount: number;
  reviewEvidenceCount: number;
}

export function buildProjectReadiness(input: ProjectReadinessInput): ReadinessItem[] {
  return [
    {
      id: "shared-files",
      label: "Shared project folder",
      state: input.dropboxLinked ? "ready" : "missing",
      detail: input.dropboxLinked
        ? "Confirmed Dropbox folder is available to the project agent."
        : "Confirm the exact Dropbox project folder before asking an agent to inspect files.",
      href: "files",
    },
    {
      id: "commercial",
      label: "Scope, phases, and contracts",
      state: input.scopeConfirmed && (input.primaryContractLinked || input.contractCount > 0)
        ? "ready"
        : input.scopeConfirmed || input.phaseCount > 0 || input.contractCount > 0
          ? "attention"
          : "missing",
      detail:
        `${input.phaseCount} phase(s), ${input.contractCount} indexed contract file(s)` +
        `${input.primaryContractLinked ? ", primary contract linked." : "."}`,
      href: "details",
    },
    {
      id: "meetings",
      label: "Meeting record",
      state: input.meetingCount > 0 ? "ready" : "attention",
      detail: input.meetingCount > 0
        ? `${input.meetingCount} structured meeting note(s) available for decisions and action items.`
        : "No structured meeting notes yet; capture decisions and action owners after the next meeting.",
      href: "meetings",
    },
    {
      id: "schedule",
      label: "Project and STUDIO schedule",
      state: input.milestoneCount > 0 && input.notionLinked
        ? "ready"
        : input.milestoneCount > 0 || input.notionLinked
          ? "attention"
          : "missing",
      detail: input.notionLinked
        ? `${input.milestoneCount} local milestone(s); confirmed items can be added to STUDIO Schedule.`
        : `${input.milestoneCount} local milestone(s); link the exact Notion project before firm-schedule writes.`,
      href: "schedule",
    },
    {
      id: "review",
      label: "Drawing QA/QC evidence",
      state: input.reviewEvidenceCount > 0 ? "ready" : "attention",
      detail: input.reviewEvidenceCount > 0
        ? `${input.reviewEvidenceCount} checklist, review, or markup record(s) are available.`
        : "No review evidence is recorded yet; inventory the current drawing set before review.",
      href: "qaqc",
    },
  ];
}

export interface LeadReadinessInput {
  dropboxLinked: boolean;
  notionLinked: boolean;
  hasContact: boolean;
  hasEstimate: boolean;
  contractStage: "not-sent" | "sent" | "under-negotiation" | "signed";
  contractCount: number;
  siteVisitCount: number;
  communicationCount: number;
  /** Confirmed meeting records. Readiness previously ignored these entirely. */
  meetingCount: number;
  /** Open questions a meeting marked as blocking progress. */
  blockingQuestionCount: number;
}

export function buildLeadReadiness(input: LeadReadinessInput): ReadinessItem[] {
  const contractStarted = input.contractStage !== "not-sent" || input.contractCount > 0;
  return [
    {
      id: "intake",
      label: "Owner and opportunity",
      state: input.hasContact && input.hasEstimate ? "ready" : "attention",
      detail: input.hasContact && input.hasEstimate
        ? "Owner contact and preliminary fee/value are recorded."
        : "Confirm the decision-maker and preliminary estimate before finalizing a proposal.",
    },
    {
      id: "lead-files",
      label: "Shared lead folder",
      state: input.dropboxLinked ? "ready" : "missing",
      detail: input.dropboxLinked
        ? "Confirmed Dropbox folder can hold site information and shared records."
        : "Confirm the exact Dropbox lead folder; Google Drive contract links can remain in contract notes.",
      href: "dropbox",
    },
    {
      id: "site-meeting",
      /*
       * Meetings count here now. This item read "ready" off site visits alone, so a lead
       * carrying two recorded meetings and a blocking fee question looked identical to one
       * where nothing had happened -- the reason a full working session changed nothing on
       * the overview.
       */
      label: "Site visit and meeting evidence",
      state: input.blockingQuestionCount > 0
        ? "attention"
        : input.siteVisitCount > 0 || input.meetingCount > 0
          ? "ready"
          : "attention",
      detail: input.blockingQuestionCount > 0
        ? `${input.blockingQuestionCount} blocking question(s) from ${input.meetingCount} meeting(s); ` +
          `${input.siteVisitCount} site visit(s) recorded.`
        : input.siteVisitCount > 0 || input.meetingCount > 0
          ? `${input.meetingCount} meeting(s), ${input.siteVisitCount} site visit(s), and ` +
            `${input.communicationCount} communication log item(s).`
          : "Schedule and document an initial site visit when the opportunity requires existing-condition review.",
      href: "meetings",
    },
    {
      id: "lead-contract",
      label: "Proposal and contract",
      state: input.contractStage === "signed"
        ? "ready"
        : contractStarted
          ? "attention"
          : "missing",
      detail: `${input.contractCount} indexed draft(s); stage is ${input.contractStage.replaceAll("-", " ")}.`,
      href: "contracts",
    },
    {
      id: "lead-sync",
      label: "Pipeline visibility",
      state: input.notionLinked ? "ready" : "attention",
      detail: input.notionLinked
        ? "Lead is linked to its confirmed Notion record."
        : "Save the lead to create or update its confirmation-gated Notion record.",
    },
  ];
}
