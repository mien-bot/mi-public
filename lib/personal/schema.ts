import { z } from "zod";
import { patchShape } from "@/lib/zodPatch";

// Deliberately local rather than imported from lib/schema: this schema is shared by a
// client component and server routes, and importing the large project schema here creates
// a Turbopack module-initialization cycle during production page-data collection.
const personalDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const personalScheduleTypeSchema = z.enum([
  "Deadline",
  "Midterm Deadline",
  "Kick-off",
  "Meeting",
  "Client Meeting",
  "Internal Meeting",
  "Work Session",
]);

export const personalRecordKindSchema = z.enum(["journal", "thought", "task", "plan"]);
export type PersonalRecordKind = z.infer<typeof personalRecordKindSchema>;

export const personalRecordStatusSchema = z.enum(["inbox", "active", "done", "archived"]);
export type PersonalRecordStatus = z.infer<typeof personalRecordStatusSchema>;

export const personalScheduleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  date: personalDateOnlySchema,
  type: personalScheduleTypeSchema,
  startTime: z.string().datetime({ offset: true }).nullable().default(null),
  endTime: z.string().datetime({ offset: true }).nullable().default(null),
}).superRefine((value, context) => {
  if (
    value.startTime
    && value.endTime
    && new Date(value.endTime).getTime() <= new Date(value.startTime).getTime()
  ) {
    context.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "End time must be after start time.",
    });
  }
});
export type PersonalSchedule = z.infer<typeof personalScheduleSchema>;

export const personalShareSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("local") }),
  z.object({
    status: z.literal("pending"),
    syncKey: z.string().min(1),
    startedAt: z.string().datetime(),
  }),
  z.object({
    status: z.literal("shared"),
    syncKey: z.string().min(1),
    notionPageId: z.string().min(1),
    notionUrl: z.string().url(),
    sharedAt: z.string().datetime(),
  }),
  z.object({
    status: z.literal("needs-review"),
    syncKey: z.string().min(1),
    attemptedAt: z.string().datetime(),
    message: z.string().min(1).max(500),
  }),
]);
export type PersonalShare = z.infer<typeof personalShareSchema>;

export const personalRecordSchema = z.object({
  id: z.string().min(1),
  kind: personalRecordKindSchema,
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(""),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  mood: z.string().trim().min(1).max(80).nullable().default(null),
  status: personalRecordStatusSchema.default("inbox"),
  schedule: personalScheduleSchema.nullable().default(null),
  /** STUDIO Schedule share state. Kept under the original field for backward compatibility. */
  share: personalShareSchema.default({ status: "local" }),
  /** Separately scoped private Notion calendar share state. */
  personalCalendarShare: personalShareSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PersonalRecord = z.infer<typeof personalRecordSchema>;

export const personalMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(100_000),
  createdAt: z.string().datetime(),
});
export type PersonalMessage = z.infer<typeof personalMessageSchema>;

export const personalConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  messages: z.array(personalMessageSchema).max(200).default([]),
  sessionId: z.string().min(1).nullable().default(null),
  engine: z.enum(["codex", "claude"]).default("codex"),
  model: z.string().max(200).default(""),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PersonalConversation = z.infer<typeof personalConversationSchema>;

export const personalDatabaseSchema = z.object({
  schemaVersion: z.literal(1),
  records: z.array(personalRecordSchema).default([]),
  /** Retained for transparent migration from the original single endless conversation. */
  conversation: z.array(personalMessageSchema).max(200).default([]),
  conversations: z.array(personalConversationSchema).max(50).default([]),
  updatedAt: z.string().datetime(),
});
export type PersonalDatabase = z.infer<typeof personalDatabaseSchema>;

export const personalRecordDraftSchema = z.object({
  kind: personalRecordKindSchema,
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).default(""),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  mood: z.string().trim().min(1).max(80).nullable().default(null),
  status: personalRecordStatusSchema.default("inbox"),
  schedule: personalScheduleSchema.nullable().default(null),
});
export type PersonalRecordDraft = z.infer<typeof personalRecordDraftSchema>;

/**
 * A real patch, not `.partial()` — see lib/zodPatch.ts. Under `.partial()` an
 * omitted `schedule` key parsed back as `null` rather than `undefined`, which
 * both cleared the stored schedule on every unrelated edit and defeated the
 * "was schedule actually in this patch?" guard in updatePersonalRecord.
 */
export const personalRecordPatchSchema = z.object(patchShape(personalRecordDraftSchema.shape));
export type PersonalRecordPatch = z.infer<typeof personalRecordPatchSchema>;

export const personalProposalSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(1_000),
  kind: z.literal("personal-record"),
  data: personalRecordDraftSchema,
});
export type PersonalProposal = z.infer<typeof personalProposalSchema>;

export const personalProposalEnvelopeSchema = z.object({
  version: z.literal(1),
  proposals: z.array(personalProposalSchema).max(12),
});
