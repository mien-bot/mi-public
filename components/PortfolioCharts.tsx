import type { PortfolioSnapshot } from "@/lib/content/portfolioAnalytics";
import { MetricCounter } from "@/components/OverviewGraphics";

interface BarDatum {
  label: string;
  value: number;
  detail?: string;
  tone?: "accent" | "success" | "warning" | "danger" | "neutral";
}

const TONE_CLASSES: Record<NonNullable<BarDatum["tone"]>, string> = {
  accent: "bg-accent",
  success: "bg-status-success-foreground",
  warning: "bg-status-warning-foreground",
  danger: "bg-status-danger-foreground",
  neutral: "bg-muted-foreground",
};

function LabeledBars({
  title,
  description,
  data,
  empty,
}: {
  title: string;
  description: string;
  data: BarDatum[];
  empty: string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby={`${title.replace(/\W+/g, "-").toLowerCase()}-heading`}>
      <h2 id={`${title.replace(/\W+/g, "-").toLowerCase()}-heading`} className="font-medium">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {total === 0 ? (
        <p className="mt-5 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div
          className="mt-5 space-y-4"
          role="img"
          aria-label={`${title}. ${data.map((item) => `${item.label}: ${item.value}${item.detail ? `, ${item.detail}` : ""}`).join(". ")}.`}
        >
          {data.map((item, index) => {
            const percent = total === 0 ? 0 : Math.round((item.value / total) * 100);
            return (
              <div key={item.label}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>{item.label}</span>
                  <span className="shrink-0 tabular-nums">
                    <MetricCounter value={item.value} />
                    {item.detail ? <span className="text-muted-foreground"> · {item.detail}</span> : null}
                  </span>
                </div>
                <div className="meter-sheen mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  {item.value > 0 ? (
                    <div
                      className={`segment-bar-fill h-full rounded-full ${TONE_CLASSES[item.tone ?? "accent"]}`}
                      style={{ width: `${Math.max(percent, 2)}%`, animationDelay: `${index * 70}ms` }}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function PortfolioCharts({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const statusData: BarDatum[] = [
    { label: "In progress", value: snapshot.statusDistribution["in-progress"], tone: "warning" },
    { label: "Not started", value: snapshot.statusDistribution["not-started"], tone: "neutral" },
    { label: "Complete", value: snapshot.statusDistribution.complete, tone: "success" },
    { label: "Abandoned", value: snapshot.statusDistribution.abandoned, tone: "neutral" },
  ];
  const healthData: BarDatum[] = [
    { label: "Measured healthy", value: snapshot.activeHealthDistribution.measuredHealthy, tone: "success" },
    { label: "Measured · needs attention", value: snapshot.activeHealthDistribution.measuredNeedsAttention, tone: "danger" },
    { label: "Partially measured", value: snapshot.activeHealthDistribution.partial, tone: "warning" },
    { label: "Unmeasured", value: snapshot.activeHealthDistribution.unmeasured, tone: "neutral" },
  ];
  const scheduleData: BarDatum[] = [
    { label: "Overdue", value: snapshot.scheduleOutlook.overdue, tone: "danger" },
    { label: "Today–7 days", value: snapshot.scheduleOutlook.next7, tone: "warning" },
    { label: "8–30 days", value: snapshot.scheduleOutlook.days8to30, tone: "accent" },
    { label: "31–90 days", value: snapshot.scheduleOutlook.days31to90, tone: "neutral" },
    { label: "Later", value: snapshot.scheduleOutlook.later, tone: "neutral" },
  ];
  const attentionData: BarDatum[] = [
    { label: "Performance / risk", value: snapshot.attentionCategoryDistribution.performance, tone: "danger" },
    { label: "Planning gaps", value: snapshot.attentionCategoryDistribution.planning, tone: "warning" },
    { label: "Data / evidence gaps", value: snapshot.attentionCategoryDistribution.evidence, tone: "neutral" },
    { label: "Integration gaps", value: snapshot.attentionCategoryDistribution.integration, tone: "accent" },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <LabeledBars
        title="Portfolio status"
        description="All portfolio projects, including complete and abandoned work."
        data={statusData}
        empty="No portfolio projects are recorded."
      />
      <LabeledBars
        title="Active-project health evidence"
        description="Health evidence is separate from the underlying deduction score."
        data={healthData}
        empty="No active projects are recorded."
      />
      <LabeledBars
        title="Schedule outlook"
        description={`Incomplete milestones for active projects as of ${snapshot.today}.`}
        data={scheduleData}
        empty="No upcoming or overdue milestones are recorded for active projects."
      />
      <LabeledBars
        title="Attention categories"
        description="Each factual reason is counted; a project may appear in more than one category."
        data={attentionData}
        empty="No active project has a current attention reason in the populated records."
      />
    </div>
  );
}

export function TrackingCoverageChart({ snapshot }: { snapshot: PortfolioSnapshot }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="tracking-coverage-heading">
      <h2 id="tracking-coverage-heading" className="font-medium">Tracking-area coverage</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Projects with at least one authored record in each area. This is descriptive coverage, not an objective completeness score.
      </p>
      {snapshot.projects.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">No portfolio projects are recorded.</p>
      ) : (
        <div
          className="mt-5 grid gap-x-6 gap-y-4 md:grid-cols-2"
          role="img"
          aria-label={`Tracking coverage across ${snapshot.projects.length} projects. ${snapshot.sourceCoverage.map((area) => `${area.label}: ${area.populatedProjects} of ${area.totalProjects}`).join(". ")}.`}
        >
          {snapshot.sourceCoverage.map((area, index) => (
            <div key={area.area}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{area.label}</span>
                <span className="shrink-0 tabular-nums">
                  {area.populatedProjects}/{area.totalProjects} · <MetricCounter value={area.percent} />%
                </span>
              </div>
              <div className="meter-sheen mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                {area.populatedProjects > 0 ? (
                  <div
                    className="segment-bar-fill h-full rounded-full bg-accent"
                    style={{ width: `${area.percent}%`, animationDelay: `${index * 70}ms` }}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
