import type { ProjectDetails, ProjectMeta, Schedule } from "@/lib/schema";

/**
 * Deliberately NOT imported from lib/content/drawingPhaseDuration.ts's
 * canonical PHASE_LABELS, even though that's normally this repo's rule
 * (see CLAUDE.md) -- that module pulls in lib/content/projects.ts, which
 * uses node:fs. This file is imported by components/ProjectInterviewPanel.tsx
 * (a "use client" component bundled for the browser), so anything it imports
 * must stay bundler-safe; a transitive node:fs import broke `next build`
 * (Turbopack: "the chunking context does not support external modules").
 * Kept in sync by hand with drawingPhaseDuration.ts's PHASE_LABELS for sd/dd/cd/ca.
 */
const DRAWING_PHASE_LABELS = {
  sd: "Schematic Design",
  dd: "Design Development",
  cd: "Construction Documents",
  ca: "Construction Administration",
} as const;

/**
 * One topic per guided-interview screen, in the order the wizard walks
 * through them. "review" is always last -- see computeInterviewSteps below.
 */
/**
 * A message that is purely a request to move between steps, so the panel can act on it itself
 * instead of sending it to the CLI. The model has no way to change the step, so asking it to
 * meant a slow round-trip that ended in "Okay, moving to the next step" while the wizard sat
 * still.
 *
 * Deliberately strict: only a bare navigation phrase counts. Anything carrying real content
 * ("skip the fee, the client is Taylor") must still reach the agent, so this never swallows an
 * answer.
 */
const NAVIGATION_PHRASES: Record<string, "next" | "back"> = {
  next: "next",
  "next step": "next",
  "next one": "next",
  skip: "next",
  "skip this": "next",
  "skip it": "next",
  "skip this step": "next",
  "skip this one": "next",
  continue: "next",
  "move on": "next",
  "moving on": "next",
  "go on": "next",
  back: "back",
  "go back": "back",
  previous: "back",
  "previous step": "back",
  "last step": "back",
};

export function parseInterviewNavigation(message: string): "next" | "back" | null {
  const normalized = message
    .trim()
    .toLowerCase()
    // Leading politeness and trailing punctuation are still a bare command.
    .replace(/^(ok(ay)?|yeah|yes|sure|please|just|no)[\s,]+/u, "")
    .replace(/[.!?,]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return NAVIGATION_PHRASES[normalized] ?? null;
}

export type InterviewStepId =
  | "client-contacts"
  | "address-scope"
  | "building-meta"
  | "team-fee"
  | "schedule"
  | "constraints-deliverables"
  | "review";

/**
 * A schedule-step keyword match, surfaced to the human rather than trusted
 * silently -- a milestone named e.g. "Permit resubmission" matching the
 * "permit" topic doesn't prove the permit milestone Mi expects actually
 * exists; a person still has to look at the exact name and confirm it.
 */
export interface MatchedScheduleMilestone {
  topic: "kick-off" | "sd" | "dd" | "cd" | "permit" | "ca";
  topicLabel: string;
  milestoneName: string;
}

export interface InterviewStepVerdict {
  id: InterviewStepId;
  label: string;
  /** True if this step still has something worth asking about. */
  needed: boolean;
  /** Human-readable reason this step was marked skippable, or null when needed. */
  skipReason: string | null;
  /**
   * Only populated for the "schedule" step -- every milestone that matched a
   * schedule topic's keywords, for "Mi found these existing milestones: ..."
   * review UI. Never used to silently mark a topic as confirmed-correct.
   */
  matchedMilestones?: MatchedScheduleMilestone[];
}

function clientContactsStep(details: ProjectDetails): InterviewStepVerdict {
  const filled = details.client_name.trim().length > 0 && details.client_contacts.length > 0;
  return {
    id: "client-contacts",
    label: "Client & contacts",
    needed: !filled,
    skipReason: filled ? "A client name and at least one contact are already on file." : null,
  };
}

function addressScopeStep(details: ProjectDetails): InterviewStepVerdict {
  const missing: string[] = [];
  if (!details.address.trim()) missing.push("address");
  if (!details.scope.trim()) missing.push("scope");
  if (!details.project_type.trim()) missing.push("project type");
  return {
    id: "address-scope",
    label: "Address & scope",
    needed: missing.length > 0,
    skipReason: missing.length === 0 ? "Address, scope, and project type are already on file." : null,
  };
}

function buildingMetaStep(meta: ProjectMeta): InterviewStepVerdict {
  const filled = meta.building_type !== null && meta.occupancy_group.length > 0;
  return {
    id: "building-meta",
    label: "Building type & occupancy",
    needed: !filled,
    skipReason: filled ? "Building type and occupancy group are already set." : null,
  };
}

function teamFeeStep(details: ProjectDetails): InterviewStepVerdict {
  const filled = details.team.length > 0 && details.fee !== null;
  return {
    id: "team-fee",
    label: "Team & fee",
    needed: !filled,
    skipReason: filled ? "A team assignment and fee are already on file." : null,
  };
}

/**
 * Milestone schema (lib/schema.ts) carries no `type` field -- only the
 * scheduleDraftItemSchema used when *creating* a schedule item has one
 * (Kick-off, Meeting, etc.), and it isn't persisted back onto a Milestone.
 * So "Kick-off" gets the exact same case-insensitive name-keyword treatment
 * as the SD/DD/CD/permit/CA phases below, rather than a structured field
 * check, for consistency and because there's nothing else to check against.
 */
const SCHEDULE_TOPICS: Array<{
  id: MatchedScheduleMilestone["topic"];
  label: string;
  keywords: string[];
}> = [
  { id: "kick-off", label: "Kick-off", keywords: ["kick-off", "kickoff", "kick off"] },
  { id: "sd", label: DRAWING_PHASE_LABELS.sd, keywords: ["schematic design", "schematic"] },
  { id: "dd", label: DRAWING_PHASE_LABELS.dd, keywords: ["design development"] },
  { id: "cd", label: DRAWING_PHASE_LABELS.cd, keywords: ["construction document", "construction documents", "cd set"] },
  { id: "permit", label: "Permit", keywords: ["permit"] },
  { id: "ca", label: DRAWING_PHASE_LABELS.ca, keywords: ["construction administration"] },
];

function matchScheduleTopics(schedule: Schedule): MatchedScheduleMilestone[] {
  const matches: MatchedScheduleMilestone[] = [];
  for (const milestone of schedule.milestones) {
    const lowered = milestone.name.toLowerCase();
    for (const topic of SCHEDULE_TOPICS) {
      if (topic.keywords.some((keyword) => lowered.includes(keyword))) {
        matches.push({ topic: topic.id, topicLabel: topic.label, milestoneName: milestone.name });
      }
    }
  }
  return matches;
}

function scheduleStep(schedule: Schedule): InterviewStepVerdict {
  const matchedMilestones = matchScheduleTopics(schedule);
  const matchedTopicIds = new Set(matchedMilestones.map((match) => match.topic));
  const allTopicsCovered = SCHEDULE_TOPICS.every((topic) => matchedTopicIds.has(topic.id));
  return {
    id: "schedule",
    label: "Plan & timeline",
    needed: !allTopicsCovered,
    skipReason: allTopicsCovered
      ? "Existing milestones already appear to cover kick-off, SD, DD, CD, permit, and CA -- review the matches below."
      : null,
    matchedMilestones,
  };
}

function constraintsDeliverablesStep(): InterviewStepVerdict {
  // No persisted schema field backs this topic (see the assignment doc), so
  // it can never be mechanically marked "already answered" -- always offered.
  return {
    id: "constraints-deliverables",
    label: "Constraints & deliverables",
    needed: true,
    skipReason: null,
  };
}

function reviewStep(): InterviewStepVerdict {
  return {
    id: "review",
    label: "Review",
    needed: true,
    skipReason: null,
  };
}

/**
 * Pure step-verdict computation for the guided project interview -- no
 * React, no file reads. Callers (ProjectInterviewPanel.tsx) fetch
 * details/meta/schedule via the existing readers and pass the data in, so
 * this stays unit-testable without rendering or touching the filesystem.
 */
export function computeInterviewSteps(
  details: ProjectDetails,
  meta: ProjectMeta,
  schedule: Schedule,
): InterviewStepVerdict[] {
  return [
    clientContactsStep(details),
    addressScopeStep(details),
    buildingMetaStep(meta),
    teamFeeStep(details),
    scheduleStep(schedule),
    constraintsDeliverablesStep(),
    reviewStep(),
  ];
}
