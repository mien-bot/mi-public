import Link from "next/link";

export interface MiFeatureGroup {
  number: string;
  title: string;
  description: string;
  capabilities: readonly string[];
  href: string;
  action: string;
  surface: string;
}

export const MI_FEATURE_GROUPS: readonly MiFeatureGroup[] = [
  {
    number: "01",
    title: "Ask Mi and work with AI",
    description:
      "Start in conversational Studio, then move into a project-aware chat when the work needs exact project context.",
    capabilities: [
      "Ask questions across firm and project knowledge",
      "Draft plans, meeting summaries, and next steps",
      "Choose Codex or Claude without silently switching providers",
    ],
    href: "/",
    action: "Open Mi",
    surface: "Mac; selected views on iPhone",
  },
  {
    number: "02",
    title: "Run every project workspace",
    description:
      "Keep the plan, decisions, documents, and delivery checks for each project in one predictable place.",
    capabilities: [
      "Portfolio health, milestones, schedules, and details",
      "Meetings, source-linked decisions, questions, and budgets",
      "Site reports, photo references, drawings, files, QA/QC, and history",
      "Occupancy, workplace, specifications, products, EPDs, time, and Chicago site intelligence",
    ],
    href: "/projects",
    action: "Browse projects",
    surface: "Mac; read-only mobile foundation",
  },
  {
    number: "03",
    title: "Move leads into active work",
    description:
      "Use a project-like workspace before a lead becomes a formal project, without losing early decisions.",
    capabilities: [
      "Lead overview, correspondence, contracts, and meetings",
      "Owner-supplied information and site visits",
      "Confirmed conversion into a project workspace",
    ],
    href: "/leads",
    action: "Browse leads",
    surface: "Mac",
  },
  {
    number: "04",
    title: "Coordinate permits and QA/QC",
    description:
      "Track jurisdiction comments and review work while preserving the source record and confirmation trail.",
    capabilities: [
      "Permit engagement status and correspondence",
      "QA/QC comments and follow-up context",
      "Confirmed Dropbox folders and bounded file access",
    ],
    href: "/permit-qaqc",
    action: "Open Permit QAQC",
    surface: "Mac",
  },
  {
    number: "05",
    title: "Find firm knowledge quickly",
    description:
      "Search across operational records, then move into curated code and reference material when the answer needs depth.",
    capabilities: [
      "Firm-wide search across projects and operational records",
      "Codes Library and reference collections",
      "Lessons learned and reusable firm knowledge",
    ],
    href: "/search",
    action: "Search Mi",
    surface: "Mac; presentation pages on iPhone",
  },
  {
    number: "06",
    title: "Connect your working environment",
    description:
      "Keep machine-specific paths and credentials local while linking shared Dropbox and Notion records deliberately.",
    capabilities: [
      "Dropbox-backed project and firm folders",
      "Notion project and schedule snapshots",
      "Personal workspace, appearance, background sync, and tools",
    ],
    href: "/settings",
    action: "Open settings",
    surface: "Desktop-only controls",
  },
] as const;

interface FeatureGuideProps {
  compact?: boolean;
  showLinks?: boolean;
}

export function FeatureGuide({
  compact = false,
  showLinks = true,
}: FeatureGuideProps) {
  return (
    <div className={compact ? "grid gap-3 sm:grid-cols-2" : "grid gap-4 md:grid-cols-2"}>
      {MI_FEATURE_GROUPS.map((feature) => (
        <article
          key={feature.number}
          className={`group flex h-full flex-col rounded-xl border border-border bg-card/60 ${
            compact ? "p-4" : "p-5 sm:p-6"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <span className="font-mono text-xs tracking-[0.18em] text-accent">
              {feature.number}
            </span>
            <span className="rounded-full border border-border px-2 py-1 text-[0.65rem] text-muted-foreground">
              {feature.surface}
            </span>
          </div>
          <h3 className={`${compact ? "mt-3 text-base" : "mt-5 text-xl"} font-display font-medium`}>
            {feature.title}
          </h3>
          <p className={`${compact ? "mt-1.5 text-xs" : "mt-2 text-sm"} text-muted-foreground`}>
            {feature.description}
          </p>
          {!compact && (
            <ul className="mt-4 space-y-2 text-sm">
              {feature.capabilities.map((capability) => (
                <li key={capability} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                  <span>{capability}</span>
                </li>
              ))}
            </ul>
          )}
          {showLinks && (
            <Link
              href={feature.href}
              className="mt-5 inline-flex items-center gap-2 self-start text-sm font-medium text-link transition-[gap] group-hover:gap-3"
            >
              {feature.action}
              <span aria-hidden="true">→</span>
            </Link>
          )}
        </article>
      ))}
    </div>
  );
}
