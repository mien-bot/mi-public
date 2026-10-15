import fs from "node:fs";
import { z } from "zod";
import { REVIEW_AUTOMATION_MODES, type ReviewAutomationMode } from "@/lib/reviewAutomation";
import { readCurrentHash, writeFileAtomically } from "./atomicContentWrite";
import type { ReviewCard } from "./reviewInbox";
import { effectiveContent, type ReviewInboxLocation } from "./reviewInbox";

/**
 * How much a workspace lets Mi do without asking.
 *
 * The default is the only setting that needs no justification: capture everything, apply
 * nothing. The other two exist because a person who has watched thirty reference entries
 * in a row get confirmed unchanged will eventually stop reading them, and a rubber-stamped
 * confirmation is worse than an honest automation rule.
 */
export const reviewAutomationModeSchema = z.enum(REVIEW_AUTOMATION_MODES);
export type { ReviewAutomationMode };

const settingsFileSchema = z.object({
  version: z.literal(1),
  automation: reviewAutomationModeSchema.default("capture-only"),
});
export type ReviewInboxSettings = z.infer<typeof settingsFileSchema>;

export const DEFAULT_REVIEW_INBOX_SETTINGS: ReviewInboxSettings = { version: 1, automation: "capture-only" };

export function readReviewInboxSettings(location: ReviewInboxLocation): ReviewInboxSettings {
  if (!fs.existsSync(location.settings)) return DEFAULT_REVIEW_INBOX_SETTINGS;
  try {
    return settingsFileSchema.parse(JSON.parse(fs.readFileSync(location.settings, "utf8")));
  } catch {
    // An unreadable setting must fail to the safe mode, never to "apply things".
    return DEFAULT_REVIEW_INBOX_SETTINGS;
  }
}

export function writeReviewInboxSettings(
  location: ReviewInboxLocation,
  automation: ReviewAutomationMode,
): ReviewInboxSettings {
  const settings = settingsFileSchema.parse({ version: 1, automation });
  writeFileAtomically(location.settings, `${JSON.stringify(settings, null, 2)}\n`, {
    expectedHash: readCurrentHash(location.settings),
    backup: false,
  });
  return settings;
}

/** Entry kinds no automation setting can ever release. */
const ALWAYS_CONFIRMED_KINDS = new Set(["meeting", "decision", "risk", "record-change"]);

/**
 * Subjects that always need a person regardless of entry kind.
 *
 * The requirement names fee, contract, schedule, and status, none of which are entry kinds
 * -- they are what an entry is *about*. Matching the target record/field is the reliable
 * signal: an entry that proposes `contract_stage` is a contract change however it was
 * labelled.
 */
const ALWAYS_CONFIRMED_SUBJECT = /fee|contract|schedul|status|estimate|price|deadline|budget/i;

export interface ConfirmationRequirement {
  required: boolean;
  reason: string;
}

/**
 * Whether this card must be confirmed by a person no matter what the workspace setting says.
 *
 * `needs_confirmation: true` is honoured first and unconditionally: the agent that wrote
 * the entry is the only party that knows it was unsure, and overriding that from a settings
 * page would make the flag decorative.
 */
export function requiresHumanConfirmation(card: ReviewCard): ConfirmationRequirement {
  if (card.needs_confirmation) {
    // Plain language on purpose: this line is read by the person confirming, and the name
    // of a JSON field in a file they never open tells them nothing about the decision.
    return { required: true, reason: "The agent that wrote it asked for your confirmation." };
  }
  if (card.entry_kind && ALWAYS_CONFIRMED_KINDS.has(card.entry_kind)) {
    return { required: true, reason: `${card.entry_kind} entries always require confirmation.` };
  }
  const content = effectiveContent(card);
  const subjects = (content?.targets ?? []).map((target) => `${target.record} ${target.field}`).join(" ");
  if (ALWAYS_CONFIRMED_SUBJECT.test(subjects)) {
    return { required: true, reason: "It proposes a fee, contract, schedule, or status change." };
  }
  return { required: false, reason: "" };
}

/** Whether the workspace setting releases this specific card. Confirmation always wins. */
export function automationAllows(card: ReviewCard, mode: ReviewAutomationMode): boolean {
  if (mode === "capture-only") return false;
  if (requiresHumanConfirmation(card).required) return false;
  if (mode === "auto-apply-reference") return card.entry_kind === "reference";
  return true;
}
