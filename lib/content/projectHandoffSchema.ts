import { z } from "zod";

export const handoffDraftSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(12000),
  nextSteps: z.string().max(6000).default(""),
  openQuestions: z.string().max(6000).default(""),
  author: z.string().trim().max(120).default(""),
  provider: z.enum(["", "codex", "claude", "other"]).default(""),
  files: z.array(z.object({ source: z.enum(["dropbox", "local"]), path: z.string().max(600), revision: z.string().max(200) })).max(30).default([]),
}).strict();
export const handoffSchema = handoffDraftSchema.extend({ version: z.literal(1), createdAt: z.string().datetime() });
