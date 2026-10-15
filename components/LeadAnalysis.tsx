import Link from "next/link";
import type { LeadAnalysisSnapshot, LeadPipelineAnalysis } from "@/lib/content/leadAnalytics";
import { StatusBadge } from "@/components/StatusBadge";

function Metric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function EvidenceCard({ snapshot }: { snapshot: LeadAnalysisSnapshot }) {
  const counts = snapshot.counts;
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-medium">Recorded evidence</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Meetings + visits" value={counts.meetings + counts.siteVisits} detail={`${counts.meetings} meetings · ${counts.siteVisits} visits`} />
        <Metric label="Correspondence" value={counts.correspondence} />
        <Metric label="Lead documents" value={counts.contracts + counts.ownerSupplied} detail={`${counts.contracts} contracts · ${counts.ownerSupplied} owner-supplied`} />
        <Metric label="Dropbox files" value={counts.dropboxFiles} detail={`${counts.dropboxFolders} folders · ${counts.sitePhotos} indexed site photos`} />
      </div>
      {snapshot.fileTypes.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-medium">Dropbox file types</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {snapshot.fileTypes.map((entry) => (
              <span key={entry.extension} className="rounded-full border border-border px-2.5 py-1 text-xs">
                {entry.extension} · {entry.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function SingleLeadAnalysis({ snapshot }: { snapshot: LeadAnalysisSnapshot }) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">Deterministic lead analysis</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-light tracking-wide">{snapshot.name}</h1>
            <StatusBadge status={snapshot.status} />
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Built from Mi records and the current filename-only Dropbox scan. No AI process or child window is required.
          </p>
        </div>
        <Link
          href={`/leads/${snapshot.slug}/chat`}
          className="rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground"
        >
          Discuss in Talk to Mi
        </Link>
      </header>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium">Briefing</h2>
        <p className="mt-3 text-sm leading-6">{snapshot.briefing}</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Days since recorded activity" value={snapshot.daysSinceRecordedActivity} detail={snapshot.lastRecordedActivity} />
        <Metric label="Estimated value" value={snapshot.estimatedValue === null ? "Not recorded" : `$${snapshot.estimatedValue.toLocaleString()}`} />
        <Metric label="Dropbox" value={snapshot.integrations.dropboxReachable ? "Reachable" : snapshot.integrations.dropboxLinked ? "Unavailable" : "Not linked"} />
        <Metric label="Notion" value={snapshot.integrations.notionLinked ? "Linked" : "Not linked"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-medium">Attention signals</h2>
          {snapshot.attentionSignals.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {snapshot.attentionSignals.map((signal) => (
                <li key={signal} className="rounded-md border border-border/70 p-3">{signal}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No deterministic attention signal is present.</p>
          )}
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-medium">Missing information</h2>
          {snapshot.missingInformation.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {snapshot.missingInformation.map((item) => (
                <li key={item} className="rounded-md border border-dashed border-border p-3">{item}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">All tracked core lead fields are populated.</p>
          )}
        </section>
      </div>

      <EvidenceCard snapshot={snapshot} />
    </div>
  );
}

export function LeadPipelineAnalysisView({ analysis }: { analysis: LeadPipelineAnalysis }) {
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <header>
        <Link href="/leads" className="text-sm text-muted-foreground hover:underline">← Back to leads</Link>
        <h1 className="mt-2 font-display text-3xl font-light tracking-wide">Lead pipeline analysis</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Local lead evidence as of {analysis.today}. This view runs in place and does not launch a child window.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium">Pipeline briefing</h2>
        <p className="mt-3 text-sm leading-6">{analysis.briefing}</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Open leads" value={analysis.openLeads} />
        <Metric label="Recorded pipeline value" value={`$${analysis.recordedPipelineValue.toLocaleString()}`} />
        <Metric label="Missing estimates" value={analysis.withoutEstimate} />
        <Metric label="Missing contacts" value={analysis.withoutContact} />
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium">Pipeline by status</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {analysis.statusCounts.map((entry) => (
            <div key={entry.status} className="rounded-md border border-border p-3">
              <StatusBadge status={entry.status} />
              <p className="mt-2 text-xl tabular-nums">{entry.count}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="font-medium">Review queue</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ordered by recorded attention signals and inactivity.</p>
          </div>
          <span className="text-sm text-muted-foreground">{analysis.reviewQueue.length} lead{analysis.reviewQueue.length === 1 ? "" : "s"}</span>
        </div>
        {analysis.reviewQueue.length ? (
          <ol className="mt-4 space-y-3">
            {analysis.reviewQueue.map((lead, index) => (
              <li key={lead.slug} className="rounded-lg border border-border/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Review {index + 1}</p>
                    <Link href={`/leads/${lead.slug}/analysis`} className="font-medium hover:underline">{lead.name}</Link>
                  </div>
                  <StatusBadge status={lead.status} />
                </div>
                <ul className="mt-3 grid gap-2 md:grid-cols-2">
                  {lead.attentionSignals.map((signal) => (
                    <li key={signal} className="rounded-md bg-muted/40 p-2 text-sm">{signal}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No open lead has a deterministic attention signal.</p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium">Integration coverage</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Metric label="Dropbox links" value={`${analysis.dropboxLinked}/${analysis.leads.length}`} />
          <Metric label="Notion links" value={`${analysis.notionLinked}/${analysis.leads.length}`} />
        </div>
      </section>
    </div>
  );
}
