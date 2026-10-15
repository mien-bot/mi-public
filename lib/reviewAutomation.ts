/**
 * The automation vocabulary, kept free of any filesystem import.
 *
 * The settings control is a client component and the store that reads this is not, so the
 * shared names live here rather than in `lib/content/reviewInboxSettings.ts` — importing
 * that module from the browser would pull `node:fs` into the bundle.
 */
export const REVIEW_AUTOMATION_MODES = [
  "capture-only",
  "auto-apply-reference",
  "auto-apply-unconfirmed",
] as const;
export type ReviewAutomationMode = (typeof REVIEW_AUTOMATION_MODES)[number];

export const REVIEW_AUTOMATION_CHOICES: {
  mode: ReviewAutomationMode;
  label: string;
  description: string;
}[] = [
  {
    mode: "capture-only",
    label: "Capture only — always require confirmation",
    description: "Every entry becomes a pending card. Nothing is written until you confirm it. (Default)",
  },
  {
    mode: "auto-apply-reference",
    label: "Automatically apply low-risk reference entries",
    description: "Reference entries the writing agent already marked as not needing confirmation are applied on import. Everything else still waits for you.",
  },
  {
    mode: "auto-apply-unconfirmed",
    label: "Automatically apply all entries where needs_confirmation is false",
    description: "Applies any entry the writing agent marked as not needing confirmation, except the kinds that always wait for you.",
  },
];

export const REVIEW_AUTOMATION_LABELS: Record<ReviewAutomationMode, string> = Object.fromEntries(
  REVIEW_AUTOMATION_CHOICES.map((choice) => [choice.mode, choice.label]),
) as Record<ReviewAutomationMode, string>;
