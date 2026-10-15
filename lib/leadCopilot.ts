import { z } from "zod";
import {
  leadContractStageSchema,
  leadSourceSchema,
  leadStatusSchema,
  meetingNoteSchema,
} from "@/lib/schema";

const proposalBaseShape = {
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(500),
};

export const leadUpdateDraftSchema = z.object({
  source: leadSourceSchema.optional(),
  status: leadStatusSchema.optional(),
  contact_name: z.string().trim().max(200).optional(),
  contact_email: z.union([z.string().email(), z.literal("")]).optional(),
  contact_phone: z.string().trim().max(100).optional(),
  referrer_name: z.string().trim().max(200).optional(),
  estimated_value: z.number().finite().nonnegative().nullable().optional(),
  notes: z.string().max(20_000).optional(),
  lost_reason: z.string().max(2_000).nullable().optional(),
  contract_stage: leadContractStageSchema.optional(),
  contract_notes: z.string().trim().max(20_000).optional(),
}).refine((value) => Object.keys(value).length > 0, "Include at least one lead field.");

/** data.entry becomes a `## {title}` section appended to the shared firm playbook -- see
 * lib/content/firmMemory.ts. Distinct from lead-update/lead-meeting, which write to this one
 * lead's own record; this writes to git-tracked firm-wide knowledge every future leads
 * conversation reads, not this lead's data. */
export const firmMemoryNoteDraftSchema = z.object({
  entry: z.string().trim().min(1).max(4_000),
});

export const leadCopilotProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    ...proposalBaseShape,
    kind: z.literal("lead-update"),
    data: leadUpdateDraftSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("lead-meeting"),
    data: meetingNoteSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("firm-memory-note"),
    data: firmMemoryNoteDraftSchema,
  }),
]);

export const leadCopilotEnvelopeSchema = z.object({
  version: z.literal(1),
  proposals: z.array(leadCopilotProposalSchema).max(20),
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

export type LeadCopilotProposal = z.infer<typeof leadCopilotProposalSchema>;

export interface ParsedLeadCopilotReply {
  text: string;
  proposals: LeadCopilotProposal[];
  proposalError: string | null;
}

const PROPOSAL_BLOCK = /```mi-lead-proposals\s*([\s\S]*?)```/gi;
const leadCopilotEnvelopeInputSchema = z.object({
  version: z.literal(1),
  proposals: z.array(z.unknown()).max(20),
});

function proposalLabel(value: unknown, index: number): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return `Proposal ${index + 1}`;
  const title = (value as Record<string, unknown>).title;
  if (typeof title !== "string" || !title.trim()) return `Proposal ${index + 1}`;
  return `Proposal ${index + 1} (“${title.trim().slice(0, 80)}”)`;
}

function proposalIssue(
  value: unknown,
  index: number,
  issue: { path: PropertyKey[]; message: string },
): string {
  const field = issue.path
    .filter((part) => part !== "data")
    .map((part) => String(part).replaceAll("_", " "))
    .join(" → ");
  return `${proposalLabel(value, index)}${field ? `, ${field}` : ""}: ${issue.message}`;
}

/**
 * The top-level proposal id is only a review-card key: it dedupes cards within one reply and
 * keys the list in the UI, and is never written to the lead record (a lead-meeting's saved id
 * is `data.id`). An agent that omits it -- the prompt lists `id` under lead-meeting's data
 * fields too -- would otherwise strand a fully reviewed meeting card, so derive one from the
 * title instead of dropping the user's content. Recovery applies only when the id is the sole
 * problem; any other issue still rejects the proposal, and no field of `data` is ever invented.
 */
function withRecoveredId(
  value: unknown,
  issues: { path: PropertyKey[] }[],
  index: number,
  usedIds: Set<string>,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!issues.every((issue) => issue.path.length === 1 && issue.path[0] === "id")) return null;

  const title = (value as Record<string, unknown>).title;
  const slug = (typeof title === "string" ? title : "")
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  const base = /^[a-z0-9][a-z0-9-]{2,79}$/.test(slug) ? slug : `proposal-${index + 1}`;
  const id = usedIds.has(base) ? `${base.slice(0, 76)}-${index + 1}` : base;
  if (usedIds.has(id)) return null;
  return { ...(value as Record<string, unknown>), id };
}

function partialValidationMessage(rejected: string[], validCount: number): string {
  const noun = rejected.length === 1 ? "change" : "changes";
  const available = validCount === 0
    ? "No review cards are available."
    : `${validCount === 1 ? "The other review card remains" : "The other review cards remain"} available.`;
  return `Mi could not validate ${rejected.length} proposed lead ${noun}: ${rejected.join(" ")} ${available}`;
}

export function parseLeadCopilotReply(raw: string): ParsedLeadCopilotReply {
  const blocks = [...raw.matchAll(PROPOSAL_BLOCK)];
  const text = raw.replace(PROPOSAL_BLOCK, "").trim();
  if (blocks.length === 0) return { text: raw.trim(), proposals: [], proposalError: null };
  if (blocks.length !== 1) {
    return {
      text,
      proposals: [],
      proposalError: "Mi received more than one lead proposal block. Ask the agent to restate the changes.",
    };
  }

  try {
    const envelope = leadCopilotEnvelopeInputSchema.safeParse(JSON.parse(blocks[0][1]));
    if (!envelope.success) {
      return {
        text,
        proposals: [],
        proposalError: `Mi could not validate the proposed lead changes: ${envelope.error.issues[0]?.message ?? "invalid proposal"}`,
      };
    }

    const proposals: LeadCopilotProposal[] = [];
    const rejected: string[] = [];
    const ids = new Set<string>();
    envelope.data.proposals.forEach((value, index) => {
      let parsed = leadCopilotProposalSchema.safeParse(value);
      if (!parsed.success) {
        const recovered = withRecoveredId(value, parsed.error.issues, index, ids);
        if (recovered !== null) parsed = leadCopilotProposalSchema.safeParse(recovered);
      }
      if (!parsed.success) {
        rejected.push(proposalIssue(
          value,
          index,
          parsed.error.issues[0] ?? { path: [], message: "Invalid proposal." },
        ));
        return;
      }
      if (ids.has(parsed.data.id)) {
        rejected.push(`${proposalLabel(value, index)}: Proposal id "${parsed.data.id}" must be unique within this response.`);
        return;
      }
      ids.add(parsed.data.id);
      proposals.push(parsed.data);
    });

    return {
      text,
      proposals,
      proposalError: rejected.length ? partialValidationMessage(rejected, proposals.length) : null,
    };
  } catch {
    return {
      text,
      proposals: [],
      proposalError: "Mi could not read the proposed lead changes. Ask the agent to restate them.",
    };
  }
}
