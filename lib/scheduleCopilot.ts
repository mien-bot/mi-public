import { z } from "zod";
import { scheduleTypeSchema } from "@/lib/schema";

const proposalBaseShape = {
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(500),
};

/** Matches electron/notionLinks.js's normalizePageId: a 32-hex Notion page id, dashes optional. */
const notionPageIdSchema = z.string().trim().regex(/^[a-f0-9-]{32,36}$/i, "Must be a Notion page id.");
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const isoDateTimeSchema = z.string().datetime({ offset: true });
export const scheduleStatusSchema = z.enum(["Not started", "In progress", "Done"]);

export const scheduleRescheduleDraftSchema = z.object({
  eventPageId: notionPageIdSchema,
  name: z.string().trim().min(1).max(240),
  currentDate: isoDateSchema,
  newDate: isoDateSchema,
  currentStartTime: isoDateTimeSchema.nullable().default(null),
  currentEndTime: isoDateTimeSchema.nullable().default(null),
  newStartTime: isoDateTimeSchema.nullable().default(null),
  newEndTime: isoDateTimeSchema.nullable().default(null),
}).superRefine((value, context) => {
  if (value.currentEndTime && !value.currentStartTime) {
    context.addIssue({ code: "custom", message: "A current start time is required when a current end time is set.", path: ["currentStartTime"] });
  }
  if (value.newEndTime && !value.newStartTime) {
    context.addIssue({ code: "custom", message: "A new start time is required when a new end time is set.", path: ["newStartTime"] });
  }
  if (value.newStartTime && value.newEndTime && Date.parse(value.newEndTime) <= Date.parse(value.newStartTime)) {
    context.addIssue({ code: "custom", message: "New end time must be after new start time.", path: ["newEndTime"] });
  }
});

export const scheduleStatusDraftSchema = z.object({
  eventPageId: notionPageIdSchema,
  name: z.string().trim().min(1).max(240),
  currentStatus: scheduleStatusSchema,
  newStatus: scheduleStatusSchema,
});

export const scheduleDuplicateDraftSchema = z.object({
  eventPageId: notionPageIdSchema,
  name: z.string().trim().min(1).max(240),
  currentDate: isoDateSchema,
  newDate: isoDateSchema,
  newStartTime: isoDateTimeSchema.nullable().default(null),
  newEndTime: isoDateTimeSchema.nullable().default(null),
}).superRefine((value, context) => {
  if (value.newEndTime && !value.newStartTime) {
    context.addIssue({ code: "custom", message: "A new start time is required when a new end time is set.", path: ["newStartTime"] });
  }
});

/**
 * `projectPageId`/`projectName` must both be null (a firm-wide entry, e.g. PTO or an
 * internal-only block) or both set to an exact id/name pulled from the confirmed project
 * list the agent was given — see electron/firmScopedAgentContext.js's buildScheduleAgentPrompt.
 * Never a guessed or partial pair.
 */
export const scheduleCreateDraftSchema = z.object({
  name: z.string().trim().min(1).max(240),
  date: isoDateSchema,
  type: scheduleTypeSchema,
  startTime: isoDateTimeSchema.nullable().default(null),
  endTime: isoDateTimeSchema.nullable().default(null),
  projectPageId: notionPageIdSchema.nullable(),
  projectName: z.string().trim().min(1).max(200).nullable(),
  attendeeIds: z.array(notionPageIdSchema).max(100).default([]),
}).superRefine((value, context) => {
  if ((value.projectPageId === null) !== (value.projectName === null)) {
    context.addIssue({
      code: "custom",
      message: "projectPageId and projectName must both be set or both be null.",
      path: ["projectPageId"],
    });
  }
  if (value.endTime && !value.startTime) {
    context.addIssue({ code: "custom", message: "A start time is required when an end time is set.", path: ["startTime"] });
  }
  if (value.startTime && value.endTime && Date.parse(value.endTime) <= Date.parse(value.startTime)) {
    context.addIssue({ code: "custom", message: "End time must be after start time.", path: ["endTime"] });
  }
});

export const scheduleCopilotProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    ...proposalBaseShape,
    kind: z.literal("schedule-remove"),
    data: z.object({
      eventPageId: notionPageIdSchema,
      name: z.string().trim().min(1).max(240),
      expectedLastEditedTime: isoDateTimeSchema,
    }),
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("schedule-reschedule"),
    data: scheduleRescheduleDraftSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("schedule-status"),
    data: scheduleStatusDraftSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("schedule-create"),
    data: scheduleCreateDraftSchema,
  }),
  z.object({
    ...proposalBaseShape,
    kind: z.literal("schedule-duplicate"),
    data: scheduleDuplicateDraftSchema,
  }),
]);

export const scheduleCopilotEnvelopeSchema = z.object({
  version: z.literal(1),
  proposals: z.array(scheduleCopilotProposalSchema).max(20),
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

export type ScheduleCopilotProposal = z.infer<typeof scheduleCopilotProposalSchema>;

export interface ParsedScheduleCopilotReply {
  text: string;
  proposals: ScheduleCopilotProposal[];
  proposalError: string | null;
}

const PROPOSAL_BLOCK = /```mi-schedule-proposals\s*([\s\S]*?)```/gi;
const scheduleCopilotEnvelopeInputSchema = z.object({
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

function partialValidationMessage(rejected: string[], validCount: number): string {
  const noun = rejected.length === 1 ? "change" : "changes";
  const available = validCount === 0
    ? "No review cards are available."
    : `${validCount === 1 ? "The other review card remains" : "The other review cards remain"} available.`;
  return `Mi could not validate ${rejected.length} proposed schedule ${noun}: ${rejected.join(" ")} ${available}`;
}

export function parseScheduleCopilotReply(raw: string): ParsedScheduleCopilotReply {
  const blocks = [...raw.matchAll(PROPOSAL_BLOCK)];
  const text = raw.replace(PROPOSAL_BLOCK, "").trim();
  if (blocks.length === 0) return { text: raw.trim(), proposals: [], proposalError: null };
  if (blocks.length !== 1) {
    return {
      text,
      proposals: [],
      proposalError: "Mi received more than one schedule proposal block. Ask the agent to restate the changes.",
    };
  }

  try {
    const envelope = scheduleCopilotEnvelopeInputSchema.safeParse(JSON.parse(blocks[0][1]));
    if (!envelope.success) {
      return {
        text,
        proposals: [],
        proposalError: `Mi could not validate the proposed schedule changes: ${envelope.error.issues[0]?.message ?? "invalid proposal"}`,
      };
    }

    const proposals: ScheduleCopilotProposal[] = [];
    const rejected: string[] = [];
    const ids = new Set<string>();
    envelope.data.proposals.forEach((value, index) => {
      const parsed = scheduleCopilotProposalSchema.safeParse(value);
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
      proposalError: "Mi could not read the proposed schedule changes. Ask the agent to restate them.",
    };
  }
}
