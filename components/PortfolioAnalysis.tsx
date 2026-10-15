import Link from "next/link";
import type {
  AttentionCategory,
  PortfolioSnapshot,
  ProjectPortfolioSnapshot,
} from "@/lib/content/portfolioAnalytics";
import { StatusBadge } from "./StatusBadge";
import { CopyPortfolioBriefing } from "./CopyPortfolioBriefing";
import { PortfolioCharts, TrackingCoverageChart } from "./PortfolioCharts";
import { DataFlowMap } from "./DataFlowMap";

const CATEGORY_LABELS: Record<AttentionCategory, string> = {
  performance: "Performance / risk",
  planning: "Planning gap",
  evidence: "Data / evidence gap",
  integration: "Integration gap",
};

function healthBadge(project: ProjectPortfolioSnapshot) {
  if (project.healthEvidenceState === "unmeasured") {
    return <StatusBadge status="pending" label="Health unmeasured" title={project.healthExplanation} />;
  }
  if (project.healthEvidenceState === "partial") {
    return <StatusBadge status="warning" label="Partially measured" title={project.healthExplanation} />;
  }
  return (
    <StatusBadge
      status={project.healthAssessment === "healthy" ? "complete" : "at-risk"}
      label={`${project.healthScore} health`}
      title={project.healthExplanation}
    />
  );
}

export function PortfolioAnalysis({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const zeroCoverage = snapshot.sourceCoverage.filter((area) => area.populatedProjects === 0);
  const maxReasonCount = Math.max(
    1,
    ...snapshot.attentionReasonDistribution.map((reason) => reason.count),
  );

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/projects"
            className="text-sm text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ← Back to projects
          </Link>
          <h1 className="mt-2 font-display text-3xl font-light tracking-wide">Portfolio analysis</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Authored local records as of {snapshot.today}. Health, performance, tracking coverage, and integrations remain separate.
          </p>
        </div>
      </header>

      <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="portfolio-briefing-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="portfolio-briefing-heading" className="font-medium">Deterministic briefing</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Generated from the portfolio snapshot without AI or external services.
            </p>
          </div>
          <CopyPortfolioBriefing briefing={snapshot.briefing} />
        </div>
        <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-6">
          {snapshot.briefing}
        </pre>
      </section>

      <PortfolioCharts snapshot={snapshot} />

      <DataFlowMap
        title="Studio data graph"
        description="Optional Obsidian-style view of how authored records feed the Mi studio picture. Node size represents record volume."
        centerLabel="Mi Studio"
        centerValue={snapshot.projects.length}
        nodes={[
          { id: "projects", label: "Projects", value: snapshot.projects.length },
          { id: "active", label: "Active", value: snapshot.activeProjects.length },
          { id: "milestones", label: "Milestones", value: Object.values(snapshot.scheduleOutlook).reduce((sum, value) => sum + value, 0) },
          { id: "attention", label: "Attention signals", value: snapshot.attentionReasonDistribution.reduce((sum, reason) => sum + reason.count, 0) },
          { id: "coverage", label: "Populated areas", value: snapshot.sourceCoverage.reduce((sum, area) => sum + area.populatedProjects, 0) },
          { id: "notion", label: "Notion links", value: snapshot.projects.filter((project) => project.notionLinkState === "confirmed").length },
          { id: "dropbox", label: "Dropbox links", value: snapshot.projects.filter((project) => project.dropboxLinkState === "confirmed").length },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="attention-reasons-heading">
        <h2 id="attention-reasons-heading" className="font-medium">Attention-reason distribution</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Number of active projects carrying each factual reason. Exact values are shown.
        </p>
        {snapshot.attentionReasonDistribution.length > 0 ? (
          <ul className="mt-5 space-y-3">
            {snapshot.attentionReasonDistribution.map((reason) => (
              <li key={reason.code}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>{reason.label}</span>
                  <span className="tabular-nums">{reason.count}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.round((reason.count / maxReasonCount) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No active project has a current attention reason in the populated records.
          </p>
        )}
      </section>

      <TrackingCoverageChart snapshot={snapshot} />

      <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="review-queue-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="review-queue-heading" className="font-medium">Active-project review queue</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ordered by the documented attention precedence; lower-level reasons remain visible.
            </p>
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">
            {snapshot.reviewQueue.length} project{snapshot.reviewQueue.length === 1 ? "" : "s"}
          </span>
        </div>
        {snapshot.reviewQueue.length > 0 ? (
          <ol className="mt-5 space-y-3">
            {snapshot.reviewQueue.map((project, index) => (
              <li key={project.slug} className="rounded-lg border border-border/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Review {index + 1}</div>
                    <Link
                      href={`/projects/${project.slug}`}
                      className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {project.name}
                    </Link>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {healthBadge(project)}
                    <StatusBadge
                      status={project.attentionPriority === "urgent" ? "overdue" : "at-risk"}
                      label={`${project.attentionPriority} priority`}
                    />
                  </div>
                </div>
                <ul className="mt-3 grid gap-2 md:grid-cols-2">
                  {project.attentionReasons.map((reason) => (
                    <li key={reason.code} className="rounded-md bg-muted/40 p-2 text-sm">
                      <span className="text-xs text-muted-foreground">
                        {CATEGORY_LABELS[reason.category]}
                      </span>
                      <div>{reason.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Source: {reason.source}</div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No active project has a current attention reason in the populated records.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="upcoming-milestones-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="upcoming-milestones-heading" className="font-medium">Upcoming milestones</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The next recorded upcoming milestone for each active project.
            </p>
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">
            {snapshot.upcomingMilestones.length} recorded
          </span>
        </div>
        {snapshot.upcomingMilestones.length > 0 ? (
          <ul className="mt-5 divide-y divide-border">
            {snapshot.upcomingMilestones.map((milestone) => (
              <li key={`${milestone.projectSlug}-${milestone.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div>
                  <Link
                    href={`/projects/${milestone.projectSlug}`}
                    className="text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {milestone.projectName}
                  </Link>
                  <div className="text-sm text-muted-foreground">{milestone.name}</div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="tabular-nums">{milestone.plannedDate}</span>
                  <Link
                    href={`/projects/${milestone.projectSlug}/schedule`}
                    className="text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Timeline
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No upcoming milestones are recorded for active projects.
          </p>
        )}
      </section>

      <section className="min-w-0 rounded-xl border border-border bg-card p-5" aria-labelledby="comparison-heading">
        <h2 id="comparison-heading" className="font-medium">Project comparison</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Scores are withheld as reliable health results when evidence is unavailable.
        </p>
        <div className="mt-5 max-w-full overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Project</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Health evidence</th>
                <th scope="col" className="px-3 py-2 font-medium">Next incomplete milestone</th>
                <th scope="col" className="px-3 py-2 font-medium">Attention reasons</th>
                <th scope="col" className="px-3 py-2 font-medium">Tracking coverage</th>
                <th scope="col" className="px-3 py-2 font-medium">Latest activity</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.projects.map((project) => (
                <tr key={project.slug} className="border-b border-border/60 align-top last:border-0">
                  <th scope="row" className="px-3 py-3 font-medium">
                    <Link href={`/projects/${project.slug}`} className="hover:underline">
                      {project.name}
                    </Link>
                  </th>
                  <td className="px-3 py-3"><StatusBadge status={project.status} /></td>
                  <td className="px-3 py-3">
                    {project.healthEvidenceState === "unmeasured"
                      ? "Unmeasured"
                      : project.healthEvidenceState === "partial"
                        ? `Partial · ${project.populatedHealthAreas.length}/6 areas`
                        : `${project.healthScore} · measured`}
                  </td>
                  <td className="px-3 py-3">
                    {project.nextIncompleteMilestone
                      ? `${project.nextIncompleteMilestone.name} · ${project.nextIncompleteMilestone.plannedDate}`
                      : "No upcoming milestone"}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{project.attentionReasons.length}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {project.trackingCoverage.populated}/{project.trackingCoverage.total} areas
                  </td>
                  <td className="px-3 py-3">
                    {project.latestRecordedActivity ?? "No recorded activity"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {snapshot.projects.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No portfolio projects are recorded.</p>
        ) : null}
      </section>

      <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="data-source-summary-heading">
        <h2 id="data-source-summary-heading" className="font-medium">Data-source availability</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Presence means at least one authored record or a human-confirmed link; it does not establish applicability or freshness.
        </p>
        {zeroCoverage.length > 0 ? (
          <ul className="mt-4 grid gap-2 text-sm md:grid-cols-2">
            {zeroCoverage.map((area) => (
              <li key={area.area} className="rounded-md border border-dashed border-border p-3">
                No {area.label.toLowerCase()} tracking data is populated.
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Every tracked source area has at least one populated project record.
          </p>
        )}
      </section>
    </div>
  );
}
