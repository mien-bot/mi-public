import Link from "next/link";
import type {
  ProjectAnalysisRecords,
  ProjectPortfolioSnapshot,
} from "@/lib/content/portfolioAnalytics";
import { TRACKING_AREA_LABELS } from "@/lib/content/portfolioAnalytics";
import { StatusBadge } from "./StatusBadge";
import { DataFlowMap } from "./DataFlowMap";

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-light tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function Bar({ label, value, total, suffix = "" }: { label: string; value: number; total: number; suffix?: string }) {
  const percent = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <li>
      <div className="flex justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="tabular-nums">{value}{suffix}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
    </li>
  );
}

export function ProjectAnalysis({
  snapshot,
  records,
  today,
  agentDraftCount,
  decisionCount,
  siteReportCount,
  conflictCount,
  sharedContent,
}: {
  snapshot: ProjectPortfolioSnapshot;
  records: ProjectAnalysisRecords;
  today: string;
  agentDraftCount: number;
  decisionCount: number;
  siteReportCount: number;
  conflictCount: number;
  sharedContent: boolean;
}) {
  const milestones = records.schedule.milestones;
  const completedMilestones = milestones.filter((milestone) => Boolean(milestone.actual_date)).length;
  const budgeted = records.budget.categories.reduce((sum, category) => sum + category.budgeted, 0);
  const committed = records.budget.categories.reduce((sum, category) => sum + category.committed, 0);
  const actual = records.budget.categories.reduce((sum, category) => sum + category.actual, 0);
  const activity = [
    ["Drawings", snapshot.drawingCount],
    ["Markups", snapshot.markup.total],
    ["Reviews", records.reviews.length],
    ["Progress logs", snapshot.progressLogCount],
    ["Meeting notes", snapshot.meetingNoteCount],
    ["Permits", records.permits.length],
  ] as const;
  const activityMax = Math.max(1, ...activity.map(([, value]) => value));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <Link href={`/projects/${snapshot.slug}`} className="text-sm text-muted-foreground hover:underline">
          ← {snapshot.name}
        </Link>
        <h1 className="mt-2 font-display text-3xl font-light tracking-wide">Project analysis</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Factual Mi records as of {today}. Blank records remain visibly unmeasured.
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Project key metrics">
        <Metric label="Health evidence" value={snapshot.healthEvidenceState === "unmeasured" ? "—" : snapshot.healthScore} detail={snapshot.healthLabel} />
        <Metric label="Tracking coverage" value={`${snapshot.trackingCoverage.populated}/${snapshot.trackingCoverage.total}`} detail="Populated record areas" />
        <Metric label="Milestones complete" value={`${completedMilestones}/${milestones.length}`} detail={`${snapshot.overdueMilestones.length} overdue`} />
        <Metric label="Recorded activity" value={activity.reduce((sum, [, value]) => sum + value, 0)} detail="Across six activity types" />
      </section>

      <DataFlowMap
        title="Project knowledge graph"
        description="Explore the records feeding this project. Drag and zoom the graph, tune its visual flow, then open the exact Mi workspace behind any node."
        centerLabel={snapshot.name}
        centerValue={snapshot.trackingCoverage.populated}
        centerHref={`/projects/${snapshot.slug}`}
        defaultOpen
        nodes={[
          { id: "schedule", label: "Milestones", value: milestones.length, href: `/projects/${snapshot.slug}/schedule`, tone: "warning", detail: "Plan & Timeline" },
          { id: "budget", label: "Budget lines", value: records.budget.categories.length, href: `/projects/${snapshot.slug}/budget`, tone: "success", detail: "Commercial evidence" },
          { id: "permits", label: "Permits", value: records.permits.length, href: `/projects/${snapshot.slug}/submissions`, tone: "warning", detail: "Submission records" },
          { id: "code", label: "Code checks", value: snapshot.codeChecklist.total, href: `/projects/${snapshot.slug}/checklist`, tone: "accent", detail: `${snapshot.codeChecklist.percentComplete}% complete` },
          { id: "qaqc", label: "QA/QC checks", value: snapshot.qaqc.total, href: `/projects/${snapshot.slug}/qaqc`, tone: snapshot.qaqc.flagged > 0 ? "danger" : "success", detail: `${snapshot.qaqc.flagged} flagged` },
          { id: "drawings", label: "Drawings", value: snapshot.drawingCount, href: `/projects/${snapshot.slug}/drawings`, tone: "accent", detail: "Drawing index" },
          { id: "markups", label: "Markups", value: snapshot.markup.total, href: `/projects/${snapshot.slug}/drawings`, tone: snapshot.markup.open > 0 ? "warning" : "success", detail: `${snapshot.markup.open} open` },
          { id: "reviews", label: "Reviews", value: records.reviews.length, href: `/projects/${snapshot.slug}/qaqc`, tone: "warning", detail: "Review evidence" },
          { id: "logs", label: "Progress logs", value: snapshot.progressLogCount, href: `/projects/${snapshot.slug}/history`, tone: "neutral", detail: "Recorded history" },
          { id: "meetings", label: "Meetings", value: snapshot.meetingNoteCount, href: `/projects/${snapshot.slug}/meetings`, tone: "accent", detail: "Notes and actions" },
          { id: "decisions", label: "Decisions", value: decisionCount, href: `/projects/${snapshot.slug}/decisions`, tone: "success", detail: "Decision register" },
          { id: "site", label: "Site reports", value: siteReportCount, href: `/projects/${snapshot.slug}/site-reports`, tone: "neutral", detail: "Field evidence" },
          { id: "agents", label: "Agent drafts", value: agentDraftCount, href: `/projects/${snapshot.slug}#project-agent-proposal-inbox`, tone: agentDraftCount > 0 ? "warning" : "neutral", detail: "Review required before write" },
          { id: "notion", label: "Notion", value: snapshot.notionLinkState === "confirmed" ? 1 : 0, href: `/projects/${snapshot.slug}/details`, tone: snapshot.notionLinkState === "confirmed" ? "success" : "danger", detail: `${snapshot.notionLinkState} link` },
          { id: "dropbox", label: "Dropbox", value: snapshot.dropboxLinkState === "confirmed" ? 1 : 0, href: `/projects/${snapshot.slug}/dropbox`, tone: conflictCount > 0 ? "danger" : snapshot.dropboxLinkState === "confirmed" ? "success" : "warning", detail: conflictCount > 0 ? `${conflictCount} conflict file(s)` : sharedContent ? "Shared project content" : "Confirmed project folder" },
        ]}
        links={[
          { source: "schedule", target: "meetings", strength: 0.8 },
          { source: "schedule", target: "notion", strength: 1.2 },
          { source: "drawings", target: "markups", strength: 1.2 },
          { source: "drawings", target: "qaqc", strength: 1 },
          { source: "markups", target: "reviews", strength: 0.9 },
          { source: "meetings", target: "decisions", strength: 1 },
          { source: "site", target: "logs", strength: 0.8 },
          { source: "agents", target: "decisions", strength: 0.7 },
          { source: "agents", target: "schedule", strength: 0.7 },
          { source: "dropbox", target: "drawings", strength: 1.1 },
          { source: "dropbox", target: "site", strength: 0.9 },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="collaboration-safety-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="collaboration-safety-heading" className="font-medium">Two-partner collaboration safety</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Mi compares the reviewed file version before every editable details and milestone write. A newer partner edit blocks the save; it is never silently overwritten.
            </p>
          </div>
          <StatusBadge status={conflictCount > 0 ? "at-risk" : "complete"} label={conflictCount > 0 ? `${conflictCount} Dropbox conflict file(s)` : "No conflict copies detected"} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Mi project records" value={sharedContent ? "Shared" : "Local"} detail={sharedContent ? "Resolved through the confirmed Dropbox project root" : "This project has not migrated its Mi records to Dropbox"} />
          <Metric label="Notion project" value={snapshot.notionLinkState === "confirmed" ? "Linked" : "Missing"} detail="External writes remain field-allowlisted and confirmed" />
          <Metric label="Agent proposals" value={agentDraftCount} detail="Validated drafts waiting for human review" />
          <Metric label="Write conflicts" value={conflictCount} detail="Dropbox conflict copies currently detected" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-medium">Schedule outlook</h2>
          <p className="mt-1 text-sm text-muted-foreground">Incomplete milestones by date horizon.</p>
          <ul className="mt-5 space-y-4">
            <Bar label="Overdue" value={snapshot.milestoneHorizons.overdue} total={Math.max(1, milestones.length)} />
            <Bar label="Next 7 days" value={snapshot.milestoneHorizons.next7} total={Math.max(1, milestones.length)} />
            <Bar label="8–30 days" value={snapshot.milestoneHorizons.days8to30} total={Math.max(1, milestones.length)} />
            <Bar label="31–90 days" value={snapshot.milestoneHorizons.days31to90} total={Math.max(1, milestones.length)} />
            <Bar label="Later" value={snapshot.milestoneHorizons.later} total={Math.max(1, milestones.length)} />
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-medium">Activity mix</h2>
          <p className="mt-1 text-sm text-muted-foreground">Count of authored local records.</p>
          <ul className="mt-5 space-y-4">
            {activity.map(([label, value]) => <Bar key={label} label={label} value={value} total={activityMax} />)}
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-medium">Quality tracking</h2>
          <div className="mt-5 space-y-5">
            <div>
              <div className="flex justify-between text-sm"><span>Code checklist</span><span>{snapshot.codeChecklist.percentComplete}%</span></div>
              <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full bg-accent" style={{ width: `${snapshot.codeChecklist.percentComplete}%` }} /></div>
              <p className="mt-1 text-xs text-muted-foreground">{snapshot.codeChecklist.flagged} flagged · {snapshot.codeChecklist.total} total</p>
            </div>
            <div>
              <div className="flex justify-between text-sm"><span>QA/QC checklist</span><span>{snapshot.qaqc.percentComplete}%</span></div>
              <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full bg-accent" style={{ width: `${snapshot.qaqc.percentComplete}%` }} /></div>
              <p className="mt-1 text-xs text-muted-foreground">{snapshot.qaqc.flagged} flagged · {snapshot.qaqc.total} total</p>
            </div>
            <div>
              <div className="flex justify-between text-sm"><span>Markup resolution</span><span>{snapshot.markup.percentResolved}%</span></div>
              <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full bg-accent" style={{ width: `${snapshot.markup.percentResolved}%` }} /></div>
              <p className="mt-1 text-xs text-muted-foreground">{snapshot.markup.open} open · {snapshot.markup.total} total</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-medium">Budget evidence</h2>
          {records.budget.categories.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No budget categories are recorded; Mi will not invent a budget.</p>
          ) : (
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              <div><p className="text-xs text-muted-foreground">Budgeted</p><p className="mt-1 tabular-nums">${budgeted.toLocaleString()}</p></div>
              <div><p className="text-xs text-muted-foreground">Committed</p><p className="mt-1 tabular-nums">${committed.toLocaleString()}</p></div>
              <div><p className="text-xs text-muted-foreground">Actual</p><p className="mt-1 tabular-nums">${actual.toLocaleString()}</p></div>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <StatusBadge status={snapshot.notionLinkState === "confirmed" ? "complete" : "pending"} label={`Notion ${snapshot.notionLinkState}`} />
            <StatusBadge status={snapshot.dropboxLinkState === "confirmed" ? "complete" : "pending"} label={`Dropbox ${snapshot.dropboxLinkState}`} />
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium">Data coverage</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[...snapshot.populatedTrackingAreas, ...snapshot.unpopulatedTrackingAreas].map((area) => {
            const populated = snapshot.populatedTrackingAreas.includes(area);
            return (
              <div key={area} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span>{TRACKING_AREA_LABELS[area]}</span>
                <span className={populated ? "text-accent" : "text-muted-foreground"}>{populated ? "Recorded" : "Blank"}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
