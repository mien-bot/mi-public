import Link from "next/link";
import type { PortfolioSnapshot } from "@/lib/content/portfolioAnalytics";
import { MetricCounter } from "@/components/OverviewGraphics";

const CATEGORY_LABELS = {
  performance: "Performance / risk",
  planning: "Planning gap",
  evidence: "Data / evidence gap",
  integration: "Integration gap",
};

export function PortfolioOverview({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const cards = [
    { label: "Active projects", value: snapshot.kpis.activeProjects },
    { label: "Active needing attention", value: snapshot.kpis.activeNeedsAttention },
    { label: "Overdue milestones", value: snapshot.kpis.overdueMilestones },
    { label: "Due in the next 30 days", value: snapshot.kpis.dueWithin30Days },
    { label: "Active health unmeasured", value: snapshot.kpis.activeUnmeasuredHealth },
  ];

  return (
    <details
      aria-labelledby="portfolio-overview-heading"
      className="group rounded-xl border border-border bg-card p-5"
    >
      <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Portfolio overview
            </p>
            <h2 id="portfolio-overview-heading" className="mt-1 font-display text-xl font-light">
              Active work and evidence
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Performance signals, tracking coverage, and confirmed integrations are reported separately.
            </p>
          </div>
          <span className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
            <span className="group-open:hidden">Show overview</span>
            <span className="hidden group-open:inline">Hide overview</span>
          </span>
        </div>
      </summary>

      <div className="mt-5 border-t border-border pt-5">
        <div className="flex justify-end">
          <Link
            href="/projects/analysis"
            className="rounded-md border border-border px-3 py-2 text-sm transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Portfolio analysis
          </Link>
        </div>

        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {cards.map((card, index) => (
            <div
              key={card.label}
              className="stat-card card-hover holo-sheen animate-fade-in-up overflow-hidden rounded-lg border border-border/70 p-3"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <dt className="text-xs text-muted-foreground">{card.label}</dt>
              <dd className="mt-1 text-2xl font-light tabular-nums">
                <MetricCounter value={card.value} />
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 border-t border-border pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">Needs attention</h3>
            <span className="text-xs text-muted-foreground">Highest-priority active projects</span>
          </div>
          {snapshot.reviewQueue.length > 0 ? (
            <ol className="mt-3 grid gap-3 lg:grid-cols-2">
              {snapshot.reviewQueue.slice(0, 4).map((project, index) => (
                <li
                  key={project.slug}
                  className="stat-card card-hover animate-fade-in-up rounded-lg border border-border/70 p-3"
                  style={{ animationDelay: `${index * 60}ms` }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link
                      href={`/projects/${project.slug}`}
                      className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {project.name}
                    </Link>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {project.attentionPriority}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {project.attentionReasons.slice(0, 3).map((reason) => (
                      <li key={reason.code}>
                        <span className="text-xs text-muted-foreground">
                          {CATEGORY_LABELS[reason.category]}:
                        </span>{" "}
                        {reason.href ? (
                          <Link href={reason.href} className="underline decoration-dotted underline-offset-2 hover:decoration-solid">
                            {reason.label} →
                          </Link>
                        ) : (
                          reason.label
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No active project has a current attention reason in the populated records.
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
