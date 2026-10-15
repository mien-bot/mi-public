import type { ProposalAction } from "@/components/ProposalReview";

/** The minimum a batch needs to know about a proposal: which actions it can run. */
export interface BatchCandidate {
  actions: ProposalAction[];
}

/**
 * The actions every selected proposal can actually run.
 *
 * Bulk work is only safe when one button means one thing. An action key that is missing or
 * disabled on even a single selected proposal is dropped from the offer rather than skipped
 * at run time, so "Confirm all 8" can never quietly become "confirm the 6 that were
 * eligible" — the same rule the review mailbox applies to bulk destinations
 * (`planBulkApply` in `lib/content/reviewInboxApply.ts`).
 *
 * Order follows the first selected proposal, so the primary action stays where the person
 * is used to seeing it.
 */
export function sharedProposalActions(selected: BatchCandidate[]): ProposalAction[] {
  if (selected.length === 0) return [];
  return selected[0].actions.filter((candidate) =>
    !candidate.disabled
    && selected.every((item) =>
      item.actions.some((action) => action.key === candidate.key && !action.disabled)));
}

/**
 * Which action a batch will run, given what the person picked.
 *
 * Derived on every render rather than stored: an action the current selection can no longer
 * run is dropped instead of silently staying chosen, a single available action needs no
 * click at all, and the primary action is the sensible default when several are shared.
 */
export function activeProposalAction(
  available: ProposalAction[],
  chosenKey: string,
): ProposalAction | null {
  return available.find((action) => action.key === chosenKey)
    ?? (available.length === 1 ? available[0] : null)
    ?? available.find((action) => action.primary)
    ?? null;
}
