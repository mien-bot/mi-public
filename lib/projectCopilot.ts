import { z } from "zod";
import {
  checkDeliverableConsistency,
  dateOnlySchema,
  disciplineSchema,
  meetingNoteSchema,
  projectDecisionIdSchema,
  projectDeliverableIdSchema,
  projectDeliverableKindSchema,
  projectDeliverableStatusSchema,
  projectDetailsSchema,
  projectMetaPatchSchema,
  projectRecordReferenceSchema,
  projectSiteReportIdSchema,
  reviewStatusSchema,
  scheduleDraftItemSchema,
  siteReportItemSchema,
} from "@/lib/schema";
import { patchShape } from "@/lib/zodPatch";

const proposalIdSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{2,79}$/);
const proposalBaseShape = {
  id: proposalIdSchema,
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(500),
};

export const projectDetailsPatchSchema = z
  .object(patchShape(projectDetailsSchema.shape))
  .refine((value) => Object.keys(value).length > 0, "Include at least one project detail.");

export const projectScheduleSuggestionSchema = scheduleDraftItemSchema.omit({
  client_request_id: true,
});

export const projectTimeEntryDraftSchema = z.object({
  name: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  hours: z.number().finite().positive().max(24),
  attendees: z.array(z.string().trim().min(1)).min(1),
  notes: z.string().trim().max(2_000).default(""),
});

/**
 * A deliverable an agent can catalogue from evidence it actually has (a dated folder it was
 * pointed at, a meeting note recording what was presented).
 *
 * `package_path` is deliberately absent from the agent contract rather than merely optional:
 * it is a Dropbox path, human-confirmed under the same rule as notion_page_id, and a folder
 * listing is exactly the kind of near-miss evidence that makes an inferred path look right.
 * The apply path stores null and the human links the folder in Mi.
 */
export const projectDeliverableDraftSchema = z.object({
  id: projectDeliverableIdSchema,
  kind: projectDeliverableKindSchema,
  title: z.string().trim().min(1).max(240),
  issued_date: dateOnlySchema.nullable().default(null),
  audience: z.string().trim().max(200).default(""),
  spaces: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  status: projectDeliverableStatusSchema,
  superseded_by: projectDeliverableIdSchema.nullable().default(null),
  notes: z.string().trim().max(4_000).default(""),
}).superRefine(checkDeliverableConsistency);

/** data.entry becomes the body under a `## {title}` heading appended to memory/notes.md -- the
 * proposal's own `title` (see proposalBaseShape) is reused as the heading, not duplicated here. */
export const memoryNoteDraftSchema = z.object({
  entry: z.string().trim().min(1).max(4_000),
});

/** Mirrors reviewFrontmatterSchema's fields (see lib/schema.ts) plus free-text finding/recommendation
 * prose -- `date` is stamped server-side at confirm time, not model-supplied. */
export const reviewFindingDraftSchema = z.object({
  discipline: disciplineSchema,
  status: reviewStatusSchema.default("open"),
  related_markups: z.array(z.string().trim().min(1)).default([]),
  related_code_sections: z.array(z.string().trim().min(1)).default([]),
  finding: z.string().trim().min(1).max(4_000),
  recommendation: z.string().trim().max(2_000).default(""),
});

export const decisionRecordDraftSchema = z.object({
  version: z.literal(1),
  id: projectDecisionIdSchema,
  title: z.string().trim().min(1).max(240),
  status: z.literal("proposed"),
  decision_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  confirmed_by: z.null().default(null),
  deciders: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  context: z.string().trim().max(10_000).default(""),
  options: z.array(z.object({
    label: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(4_000).default(""),
  })).max(20).default([]),
  outcome: z.string().trim().max(10_000).default(""),
  rationale: z.string().trim().max(10_000).default(""),
  consequences: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
  affected_deliverables: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  sources: z.array(projectRecordReferenceSchema).min(1).max(50),
  supersedes: z.null().default(null),
  superseded_by: z.null().default(null),
});

export const siteReportDraftSchema = z.object({
  version: z.literal(1),
  id: projectSiteReportIdSchema,
  title: z.string().trim().min(1).max(240),
  status: z.literal("draft"),
  origin: z.literal("ai-assisted"),
  visit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  confirmed_by: z.null().default(null),
  purpose: z.string().trim().max(4_000).default(""),
  scope: z.string().trim().max(10_000).default(""),
  participants: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    role: z.string().trim().max(200).default(""),
  })).max(100).default([]),
  conditions: z.object({
    weather: z.string().trim().max(500).default(""),
    access: z.string().trim().max(2_000).default(""),
    lighting: z.string().trim().max(500).default(""),
    occupancy: z.string().trim().max(500).default(""),
    active_work: z.string().trim().max(1_000).default(""),
  }).default({
    weather: "",
    access: "",
    lighting: "",
    occupancy: "",
    active_work: "",
  }),
  sources: z.array(projectRecordReferenceSchema).max(50).default([]),
  items: z.array(siteReportItemSchema).max(250).default([]),
  raw_notes: z.string().max(100_000).default(""),
  professional_review_required: z.literal(true),
});

export const projectCopilotProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    ...proposalBaseShape,
    kind: z.literal("project-details"),
    data: projectDetailsPatchSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("meeting-note"),
    data: meetingNoteSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("schedule-item"),
    data: projectScheduleSuggestionSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("time-entry"),
    data: projectTimeEntryDraftSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("deliverable"),
    data: projectDeliverableDraftSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("memory-note"),
    data: memoryNoteDraftSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("review-finding"),
    data: reviewFindingDraftSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("decision-record"),
    data: decisionRecordDraftSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("site-report"),
    data: siteReportDraftSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("project-meta"),
    data: projectMetaPatchSchema,
  }),
]);

export const projectCopilotEnvelopeSchema = z.object({
  version: z.literal(1),
  proposals: z.array(projectCopilotProposalSchema).max(20),
}).superRefine(({ proposals }, context) => {
  const ids = new Set<string>();
  proposals.forEach((proposal, index) => {
    if (ids.has(proposal.id)) {
      context.addIssue({
        code: "custom",
        path: ["proposals", index, "id"],
        message: `Proposal id "${proposal.id}" must be unique within this response.`,
      });
    }
    ids.add(proposal.id);
  });
});

export type ProjectCopilotProposal = z.infer<typeof projectCopilotProposalSchema>;
export type ProjectTimeEntryDraft = z.infer<typeof projectTimeEntryDraftSchema>;

export interface ParsedProjectCopilotReply {
  text: string;
  proposals: ProjectCopilotProposal[];
  proposalError: string | null;
}

const PROPOSAL_BLOCK = /```mi-proposals\s*([\s\S]*?)```/gi;

function issuePath(path: PropertyKey[]): string {
  if (path.length === 0) return "proposal";
  return path.reduce<string>((current, segment) => (
    typeof segment === "number"
      ? `${current}[${segment}]`
      : current
        ? `${current}.${String(segment)}`
        : String(segment)
  ), "");
}

function proposalValidationError(error: z.ZodError): string {
  const details = error.issues
    .slice(0, 10)
    .map((issue) => `${issuePath(issue.path)}: ${issue.message}`)
    .join("; ");
  const remainder = error.issues.length > 10
    ? `; plus ${error.issues.length - 10} more issue(s)`
    : "";
  return `Mi could not validate the proposed changes: ${details || "invalid proposal"}${remainder}`;
}

function decodeProposalEnvelope(raw: string, text: string): ParsedProjectCopilotReply {
  try {
    const decoded: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return {
        text,
        proposals: [],
        proposalError: "Mi proposal input must be a JSON object with version and proposals fields.",
      };
    }
    const parsed = projectCopilotEnvelopeSchema.safeParse(decoded);
    if (!parsed.success) {
      return { text, proposals: [], proposalError: proposalValidationError(parsed.error) };
    }
    return { text, proposals: parsed.data.proposals, proposalError: null };
  } catch {
    return {
      text,
      proposals: [],
      proposalError: "Mi could not read the proposed changes as JSON.",
    };
  }
}

/**
 * Pulls the machine-readable proposal envelope out of an otherwise normal
 * conversational reply. Invalid model output never becomes an actionable
 * button: it is removed from display and surfaced as a validation message.
 */
export function parseProjectCopilotReply(raw: string): ParsedProjectCopilotReply {
  const blocks = [...raw.matchAll(PROPOSAL_BLOCK)];
  const text = raw.replace(PROPOSAL_BLOCK, "").trim();
  if (blocks.length === 0) return { text: raw.trim(), proposals: [], proposalError: null };
  if (blocks.length !== 1) {
    return {
      text,
      proposals: [],
      proposalError: "Mi received more than one proposal block. Ask the agent to restate the changes.",
    };
  }

  return decodeProposalEnvelope(blocks[0][1], text);
}

/**
 * File ingestion accepts either a bare proposal envelope or the same fenced form chat emits.
 * Ordinary prose still follows the chat parser and produces no proposal rather than being
 * treated as a file. Both sources converge on the exact same envelope schema above.
 */
export function parseProjectProposalSource(raw: string): ParsedProjectCopilotReply {
  const normalized = raw.replace(/^\uFEFF/, "").trim();
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    return decodeProposalEnvelope(normalized, "");
  }
  return parseProjectCopilotReply(normalized);
}

export function proposalKindLabel(kind: ProjectCopilotProposal["kind"]): string {
  switch (kind) {
    case "project-details": return "Project information";
    case "meeting-note": return "Meeting note";
    case "schedule-item": return "Plan & timeline";
    case "time-entry": return "Hours & team";
    case "deliverable": return "Deliverables";
    case "memory-note": return "Project memory";
    case "review-finding": return "Review finding";
    case "decision-record": return "Decision proposal";
    case "site-report": return "Site report draft";
    case "project-meta": return "Building & occupancy";
  }
}
