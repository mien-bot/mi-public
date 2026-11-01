import type { Milestone, ProjectDetails } from "./schema";

/** Which schedule items deserve attention first. Derived for display; never written to a record. */
export type ScheduleTier = "critical" | "high" | "normal" | "low";

const TIER_ORDER: Record<ScheduleTier, number> = { critical: 0, high: 1, normal: 2, low: 3 };
export const compareTier = (a: ScheduleTier, b: ScheduleTier) => TIER_ORDER[a] - TIER_ORDER[b];

export function milestoneTier(milestone: Pick<Milestone, "name" | "priority">): ScheduleTier {
  if (milestone.priority) return milestone.priority;
  if (/\b(contract|permit|deadline|due|submission|submittal|bid|inspection)\b/i.test(milestone.name)) return "critical";
  if (/\b(payment|invoice|kick-?off|review|issue|approval)\b/i.test(milestone.name)) return "high";
  if (/\bmeeting\b/i.test(milestone.name)) return "low";
  return "normal";
}

/** Tier for a Notion STUDIO Schedule entry, from its existing Type values. */
export function scheduleEntryTier(types: string[]): ScheduleTier {
  const values = types.map((type) => type.toLowerCase());
  if (values.includes("deadline")) return "critical";
  if (values.some((type) => type.includes("deadline") || type.includes("kick-off"))) return "high";
  if (values.some((type) => type.includes("meeting"))) return "low";
  return "normal";
}

export interface TimelineMarker {
  id: string;
  date: string;
  name: string;
  tier: ScheduleTier;
  kind: "milestone" | "payment" | "contract";
  done: boolean;
  notionEventId: string | null;
}

export interface TimelinePhase {
  id: string;
  name: string;
  start: string;
  end: string;
  status: string;
  progress: number | null;
}

export interface TimelineRow {
  slug: string;
  name: string;
  phases: TimelinePhase[];
  markers: TimelineMarker[];
  contractEnd: string;
  details: Pick<ProjectDetails, "phases" | "payments" | "contract_end_date">;
}

export function timelineRow(
  project: { slug: string; name: string },
  milestones: Milestone[],
  details: ProjectDetails,
): TimelineRow {
  const markers: TimelineMarker[] = milestones.filter((item) => item.planned_date).map((item) => ({
    id: item.id,
    date: item.planned_date.slice(0, 10),
    name: item.name,
    tier: milestoneTier(item),
    kind: "milestone",
    done: Boolean(item.actual_date),
    notionEventId: item.notion_event_id,
  }));
  for (const payment of details.payments) {
    if (!payment.due_date) continue;
    markers.push({
      id: `payment-${payment.id}`,
      date: payment.due_date,
      name: `Payment: ${payment.label}`,
      tier: "high",
      kind: "payment",
      done: Boolean(payment.paid_date),
      notionEventId: null,
    });
  }
  if (details.contract_end_date) {
    markers.push({
      id: "contract-end",
      date: details.contract_end_date,
      name: "Contract end",
      tier: "critical",
      kind: "contract",
      done: false,
      notionEventId: null,
    });
  }
  return {
    ...project,
    markers: markers.sort((a, b) => a.date.localeCompare(b.date)),
    phases: details.phases
      .filter((phase) => phase.planned_start_date && phase.planned_end_date)
      .map((phase) => ({
        id: phase.id,
        name: phase.name,
        start: phase.planned_start_date,
        end: phase.planned_end_date,
        status: phase.status,
        progress: phase.progress_percent,
      })),
    contractEnd: details.contract_end_date,
    details: { phases: details.phases, payments: details.payments, contract_end_date: details.contract_end_date },
  };
}

export function upcomingMarkers(rows: TimelineRow[], today: string, days = 60) {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  const last = end.toISOString().slice(0, 10);
  return rows
    .flatMap((row) => row.markers.map((marker) => ({ ...marker, slug: row.slug, project: row.name })))
    .filter((marker) => !marker.done && marker.date <= last && (marker.tier === "critical" || marker.tier === "high"))
    .sort((a, b) => a.date.localeCompare(b.date) || compareTier(a.tier, b.tier));
}

/** What moving a date would run into. These warn a person; they never block the move. */
export function slipWarnings(
  details: TimelineRow["details"] | null,
  from: string,
  to: string,
): string[] {
  if (!details || to <= from) return [];
  const warnings: string[] = [];
  if (details.contract_end_date && to > details.contract_end_date && from <= details.contract_end_date) {
    warnings.push(`This moves past the contract end date, ${details.contract_end_date}.`);
  }
  const dated = details.phases.filter((phase) => phase.planned_start_date && phase.planned_end_date);
  const phase = dated.find((item) => item.planned_start_date <= from && from <= item.planned_end_date);
  if (phase) {
    if (to > phase.planned_end_date) warnings.push(`This moves past the end of ${phase.name}, ${phase.planned_end_date}.`);
    const next = dated
      .filter((item) => item.planned_start_date > phase.planned_end_date)
      .sort((a, b) => a.planned_start_date.localeCompare(b.planned_start_date))[0];
    if (next && to >= next.planned_start_date) warnings.push(`This overlaps the start of ${next.name}, ${next.planned_start_date}.`);
    for (const payment of details.payments) {
      if (payment.phase_id === phase.id && !payment.paid_date && payment.due_date && payment.due_date < to && payment.due_date >= from) {
        warnings.push(`Payment “${payment.label}” is due ${payment.due_date}, before the new date.`);
      }
    }
  }
  return warnings;
}
