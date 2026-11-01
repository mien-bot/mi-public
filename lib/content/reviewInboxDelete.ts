import { z } from "zod";
import { hashContent } from "./atomicContentWrite";
import { workspaceKindSchema } from "./workspaceOutbox";
import { locateReviewInbox, readReviewCardsIn, effectiveContent } from "./reviewInbox";
import { dismissReviewCard, ReviewActionError } from "./reviewInboxService";

export const inboxDeleteSchema = z.array(z.object({
  kind: workspaceKindSchema,
  slug: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(200),
  cardId: z.string().min(1).max(200),
})).min(1).max(100).refine(items => new Set(items.map(item =>
  JSON.stringify([item.kind, item.slug, item.cardId]))).size === items.length,
"Select each item only once.");
export type InboxDeleteSelection = z.infer<typeof inboxDeleteSchema>;

export function previewInboxDelete(selection: InboxDeleteSelection) {
  const snapshots = inboxDeleteSchema.parse(selection).map(item => {
    const location = locateReviewInbox(item.kind, item.slug);
    if (!location) throw new ReviewActionError("Inbox unavailable. Refresh and try again.", 404);
    const card = readReviewCardsIn(location).find(card => card.id === item.cardId);
    if (!card || !["pending", "failed"].includes(card.status)) {
      throw new ReviewActionError("An item changed. Refresh and select it again.", 409);
    }
    return { ...item, location, card };
  });
  return {
    fingerprint: hashContent(JSON.stringify(snapshots)),
    items: snapshots.map(({ card, kind, slug, cardId }) => ({
      kind, slug, cardId, title: effectiveContent(card)?.title || card.source.file_name,
    })),
  };
}

export function confirmInboxDelete(selection: InboxDeleteSelection, fingerprint: string, reviewedBy: string) {
  // Preflight every workspace before changing any receipt; destinations are irrelevant.
  const preview = previewInboxDelete(selection);
  if (!fingerprint || preview.fingerprint !== fingerprint) {
    throw new ReviewActionError("The selected items changed. Review the deletion again.", 409);
  }
  return preview.items.map(item => {
    try {
      dismissReviewCard({ ...item, reviewedBy, reason: "Deleted from inbox after two confirmations." });
      return { ...item, deleted: true, error: "" };
    } catch (cause) {
      return { ...item, deleted: false, error: cause instanceof Error ? cause.message : "Could not delete this item. Refresh to check its status." };
    }
  });
}
