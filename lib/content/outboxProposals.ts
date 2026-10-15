import { leadUpdateDraftSchema } from "@/lib/leadCopilot";
import type { Lead } from "@/lib/schema";
import type { WorkspaceOutboxEntry } from "./workspaceOutbox";

/**
 * A pending entry rendered as something a person can act on.
 *
 * `patch` is present only when the entry names a record field Mi is allowed to write and
 * the proposed value survives that field's own schema. Everything else is still shown --
 * an entry Mi cannot apply is not an entry Mi should hide -- but it carries no patch, so
 * the UI offers acknowledgement rather than a misleading Apply button.
 */
export interface EntryReviewCard {
  entryId: string;
  title: string;
  reason: string;
  body: string;
  visibility: "internal" | "client-visible";
  evidence: string[];
  sourceLabel: string;
  changes: { field: string; current: string; proposed: string }[];
  patch: Record<string, unknown> | null;
  /** Why no patch was built, when there is none. Shown so a card never looks broken. */
  unappliableReason: string | null;
}

/** Fields a lead outbox entry may propose, mirroring leadUpdateDraftSchema exactly. */
const LEAD_WRITABLE_FIELDS = new Set([
  "source",
  "status",
  "contact_name",
  "contact_email",
  "contact_phone",
  "referrer_name",
  "estimated_value",
  "notes",
  "lost_reason",
  "contract_stage",
  "contract_notes",
]);

/**
 * Coerces a proposed value to the type its field expects.
 *
 * Outbox entries are JSON written by an agent, so every proposed value arrives as a
 * string. `estimated_value` is the only numeric lead field today; anything that does not
 * parse cleanly is rejected rather than coerced to NaN or zero, because a silently wrong
 * fee is worse than an entry Mi declines to apply.
 */
function coerceLeadValue(field: string, proposed: string): unknown {
  if (field === "estimated_value") {
    const numeric = Number(proposed.replace(/[$,\s]/g, ""));
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
  }
  return proposed;
}

function describeCurrent(lead: Lead, field: string): string {
  const value = (lead as unknown as Record<string, unknown>)[field];
  if (value === null || value === undefined || value === "") return "not set";
  return String(value);
}

/**
 * Turns pending entries into review cards.
 *
 * Nothing here writes. The cards feed the existing confirmed apply path, so an entry
 * changes a record only after a person presses Apply on the card -- the same gate a chat
 * proposal passes through.
 */
export function leadReviewCards(
  entries: WorkspaceOutboxEntry[],
  lead: Lead,
): EntryReviewCard[] {
  return entries.map((entry) => {
    const targets = entry.targets.filter((target) => /^lead\.ya?ml$/i.test(target.record));
    const writable = targets.filter((target) => LEAD_WRITABLE_FIELDS.has(target.field));

    const draft: Record<string, unknown> = {};
    for (const target of writable) {
      const value = coerceLeadValue(target.field, target.proposed);
      if (value !== undefined) draft[target.field] = value;
    }
    const parsed = Object.keys(draft).length > 0 ? leadUpdateDraftSchema.safeParse(draft) : null;

    let unappliableReason: string | null = null;
    if (entry.targets.length === 0) {
      unappliableReason = "This entry records knowledge rather than a field change.";
    } else if (targets.length === 0) {
      unappliableReason = `It targets ${entry.targets.map((target) => target.record).join(", ")}, which this page does not write.`;
    } else if (writable.length === 0) {
      unappliableReason = `Mi does not write ${targets.map((target) => target.field).join(", ")} from a review card.`;
    } else if (!parsed?.success) {
      unappliableReason = parsed?.error.issues[0]?.message ?? "The proposed value is not valid for that field.";
    }

    return {
      entryId: entry.id,
      title: entry.title,
      reason: entry.why || entry.body,
      body: entry.body,
      visibility: entry.visibility,
      evidence: entry.evidence.map((item) => item.path ?? item.quote).filter(Boolean),
      sourceLabel: `${entry.session.agent} · ${entry.created_at.slice(0, 10)}`,
      changes: writable.map((target) => ({
        field: target.field,
        current: describeCurrent(lead, target.field),
        proposed: target.proposed,
      })),
      patch: parsed?.success ? parsed.data : null,
      unappliableReason,
    };
  });
}
