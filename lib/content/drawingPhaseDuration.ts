import { getDrawingIndex } from "./projects";
import type { DrawingPhase } from "@/lib/schema";

/** Hoisted from app/projects/[slug]/drawings/page.tsx so this module and that page share one definition. */
export const PHASE_LABELS: Record<DrawingPhase, string> = {
  sd: "Schematic Design",
  dd: "Design Development",
  cd: "Construction Documents",
  ca: "Construction Administration",
};
export const PHASE_ORDER: DrawingPhase[] = ["sd", "dd", "cd", "ca"];

export interface PhaseDuration {
  phase: DrawingPhase;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  entryCount: number;
}

/**
 * A coarse proxy for "time spent in phase," not a true phase-transition
 * record: startDate is the earliest drawing-entry date in a phase, endDate
 * is the earliest entry date of the next populated phase (or null if this
 * is the last populated phase — still current, or no later phase started).
 * Don't over-trust this for anything more precise than a rough estimate.
 */
export function getDrawingPhaseDurations(slug: string): PhaseDuration[] {
  const entries = getDrawingIndex(slug);

  const phaseStarts = new Map<DrawingPhase, string>();
  for (const phase of PHASE_ORDER) {
    const dates = entries.filter((e) => e.phase === phase).map((e) => e.date);
    if (dates.length > 0) phaseStarts.set(phase, dates.sort()[0]);
  }

  const populatedPhasesInOrder = PHASE_ORDER.filter((p) => phaseStarts.has(p));

  return PHASE_ORDER.map((phase) => {
    const startDate = phaseStarts.get(phase) ?? null;
    const entryCount = entries.filter((e) => e.phase === phase).length;

    if (!startDate) {
      return { phase, startDate: null, endDate: null, durationDays: null, entryCount };
    }

    const currentIndex = populatedPhasesInOrder.indexOf(phase);
    const nextPhase = populatedPhasesInOrder[currentIndex + 1];
    const endDate = nextPhase ? (phaseStarts.get(nextPhase) as string) : null;

    const durationDays = endDate
      ? Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return { phase, startDate, endDate, durationDays, entryCount };
  });
}
