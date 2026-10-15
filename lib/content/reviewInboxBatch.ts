import { z } from "zod";
import { hashContent } from "./atomicContentWrite";
import { reviewDestinationKindSchema } from "./reviewInbox";
import { workspaceKindSchema, resolveWorkspace } from "./workspaceOutbox";
import { contentDir } from "./projects";
import { previewBulkApply, confirmReviewCard, ReviewActionError } from "./reviewInboxService";

export const reviewBatchSchema = z.array(z.object({
  kind: workspaceKindSchema,
  slug: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200),
  cardIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  destinationKind: reviewDestinationKindSchema,
})).min(1).max(50).superRefine((groups, ctx) => {
  if (groups.reduce((sum, group) => sum + group.cardIds.length, 0) > 100) {
    ctx.addIssue({ code: "custom", message: "Select up to 100 items per batch." });
  }
  const keys = groups.map(group => `${group.kind}/${group.slug}`);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: "custom", message: "Each workspace must appear only once." });
  }
});
export type ReviewBatchSelection = z.infer<typeof reviewBatchSchema>;

export function previewReviewBatch(selection: ReviewBatchSelection) {
  const groups = reviewBatchSchema.parse(selection).map(group => ({
    ...group, plan: previewBulkApply(group),
  }));
  return {
    groups,
    allowed: groups.every(group => group.plan.allowed),
    fingerprint: hashContent(JSON.stringify(groups.map(group => ({
      kind: group.kind, slug: group.slug, fingerprint: group.plan.fingerprint,
      destinations: group.plan.effects.map(effect => effect.record),
      workspaceRoot: resolveWorkspace(group.kind, group.slug).workspaceRoot,
      recordRoot: group.kind === "project" ? contentDir(group.slug) : resolveWorkspace(group.kind, group.slug).recordDir,
    })))),
  };
}
export type ReviewBatchPlan = ReturnType<typeof previewReviewBatch>;

export function confirmReviewBatch(selection: ReviewBatchSelection, fingerprint: string, reviewedBy: string) {
  // Check EVERY workspace before the first write. A stale later project must not
  // silently leave the earlier projects applied under an outdated batch preview.
  const preview = previewReviewBatch(selection);
  if (!fingerprint || preview.fingerprint !== fingerprint) {
    throw new ReviewActionError("This batch changed. Review the selected items again before accepting.");
  }
  if (!preview.allowed) throw new ReviewActionError("Resolve the blocked items before accepting this batch.");
  return preview.groups.map(group => {
    const result = { kind: group.kind, slug: group.slug, applied: 0, failed: 0, errors: [] as string[], warnings: [] as string[] };
    for (const cardId of group.cardIds) {
      try {
        const outcome = confirmReviewCard({ ...group, cardId, reviewedBy });
        if (outcome.applied) {
          result.applied++;
          if (outcome.warning) result.warnings.push(outcome.warning);
        }
        else { result.failed++; result.errors.push(outcome.message); }
      } catch (error) {
        result.failed++;
        result.errors.push(error instanceof Error ? error.message : "Could not save this item. Refresh to check it.");
      }
    }
    return result;
  });
}

export type ReviewBatchResult = ReturnType<typeof confirmReviewBatch>;
