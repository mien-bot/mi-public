import Link from "next/link";
import { connection } from "next/server";
import { ProjectDiscoveryPanel } from "@/components/ProjectDiscoveryPanel";
import { ProjectBrief } from "@/components/ProjectBrief";
import { notFound } from "next/navigation";
import {
  getLessonsLearned,
  listAgentProposalInbox,
  getMeetingNotes,
  getMepNotes,
  getProjectDetails,
  getProjectDocuments,
  getProjectMemory,
  getProjectDecisions,
  getProjectLinks,
  getProjectPortfolioIntelligence,
  getProjectSlugs,
  getProjectDeliverables,
  getProjectSiteReports,
  resolveProjectIdentity,
  schedulePath,
  getSchedule,
  TRACKING_AREA_LABELS,
} from "@/lib/content";
import { readCurrentHash } from "@/lib/content/atomicContentWrite";
import {
  KNOWLEDGE_GROUPS,
  KNOWLEDGE_GROUP_LABELS,
  readProjectKnowledge,
  sortKnowledgeEntries,
} from "@/lib/content/projectKnowledge";
import { StatusBadge } from "@/components/StatusBadge";
import { OpenInNotionButton } from "@/components/OpenInNotionButton";
import { ProjectStatusControl } from "@/components/ProjectStatusControl";
import { getNotionProjectMapEntry } from "@/lib/notion/projectMap";
import { ProjectIdentity } from "@/components/ProjectIdentity";
import { ProjectMilestoneOverview } from "@/components/ProjectMilestoneOverview";
import { NotionLink } from "@/components/NotionLink";
import { NotionScheduleActivity } from "@/components/NotionScheduleActivity";
import { formatHoursAndMinutes } from "@/lib/duration";
import { WorkflowReadiness } from "@/components/WorkflowReadiness";
import { buildProjectReadiness } from "@/lib/workflows/operationsReadiness";
import { AgentProposalInbox } from "@/components/AgentProposalInbox";
import { PendingReviewPanel } from "@/components/PendingReviewPanel";
import { WorkspaceAnalysisPanel } from "@/components/WorkspaceAnalysis";
import { readWorkspaceReviewSummary } from "@/lib/content/reviewInboxService";
import { analysisNudge, readStoredAnalysis } from "@/lib/content/workspaceAnalysisStore";
import { PendingApprovalsBanner } from "@/components/PendingApprovalsBanner";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import {
  CountPips,
  HealthRing,
  MiniMeter,
  SegmentBar,
  SourceChip,
  StatCard,
} from "@/components/OverviewGraphics";
import { getProjectPendingApprovals } from "@/lib/content/pendingApprovals";

/** Ring color for each resolved health badge state, kept beside the badge map it follows. */
const HEALTH_RING_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  complete: "success",
  "at-risk": "warning",
  overdue: "danger",
  pending: "neutral",
  warning: "warning",
};

const HEALTH_BUCKET_STATUS: Record<string, string> = {
  success: "complete",
  warning: "at-risk",
  danger: "overdue",
  neutral: "pending",
};

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

/**
 * One record set as a way in: how many there are, what state they are in, and a drawn
 * detail where the record has a meaningful proportion to show. The count stays the loudest
 * thing on the card -- the graphic is a second read, not the headline.
 */
function RecordLink({ href, label, count, hint, icon, children, delayMs }: {
  href: string;
  label: string;
  count: number;
  hint: string;
  icon: AppIconName;
  children?: React.ReactNode;
  delayMs?: number;
}) {
  return (
    <Link
      href={href}
      className="stat-card card-hover animate-fade-in-up group flex flex-col rounded-lg border border-border bg-card p-3.5 hover:border-accent"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border bg-background/60 text-accent">
          <AppIcon name={icon} className="mode-icon h-3.5 w-3.5" />
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-display text-2xl font-light leading-none tabular-nums">{count}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {children && <div className="mt-2.5">{children}</div>}
    </Link>
  );
}

function Unset({ children = "Not recorded" }: { children?: string }) {
  return <span className="text-muted-foreground">{children}</span>;
}

/**
 * The project overview.
 *
 * Ordered by what a person came to find out, not by what Mi can do: the record's own facts
 * first, then what needs attention, then what is waiting on a confirmation, then the
 * schedule and recent activity. Everything that is a control rather than a fact —
 * regenerating the workspace, running Analyze, editing readiness — sits under a disclosure,
 * because a screen of entry points reads as a menu rather than as a project.
 */
export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const slugs = new Set(getProjectSlugs());
  if (!slugs.has(slug)) notFound();

  const { snapshot: intelligence, records } = getProjectPortfolioIntelligence(slug);
  const project = records.project;
  const markupResolution = intelligence.markup;
  const staleReviewCount = intelligence.staleReviewCount;
  const progressLog = records.progressLogs;
  const reviews = records.reviews;
  const markups = records.markups;
  const mepNotes = getMepNotes(slug);
  const permits = records.permits;
  const lessons = getLessonsLearned(slug);
  const projectLinks = getProjectLinks(slug);
  const schedule = records.schedule;
  // The milestone status controls below send this back on save so the API can refuse a write
  // that would clobber a concurrent schedule edit.
  const scheduleHash = readCurrentHash(schedulePath(slug));
  const details = getProjectDetails(slug);
  const knowledge = readProjectKnowledge(getProjectMemory(slug));
  const pendingApprovals = getProjectPendingApprovals(slug);
  const agentProposalInbox = listAgentProposalInbox(slug);
  const pendingProposalCount = agentProposalInbox
    .reduce((total, record) => total + record.pendingProposals.length, 0);
  const contractDocuments = getProjectDocuments(slug, "contracts");
  const meetings = getMeetingNotes(slug);
  const decisions = getProjectDecisions(slug);
  const siteReports = getProjectSiteReports(slug);
  const deliverables = getProjectDeliverables(slug);
  const reviewSummary = readWorkspaceReviewSummary("project", slug);
  const decisionCutoff = new Date();
  decisionCutoff.setUTCDate(decisionCutoff.getUTCDate() - 30);
  const decisionCutoffDate = decisionCutoff.toISOString().slice(0, 10);
  const recentDecisionCount = decisions.filter(({ decision }) =>
    decision.status !== "proposed" && decision.decision_date >= decisionCutoffDate,
  ).length;
  const openDecisionCount = decisions.filter(({ decision }) => decision.status === "proposed").length;
  const draftSiteReportCount = siteReports.filter(({ report }) => report.status === "draft").length;
  const issuedDeliverableCount = deliverables.filter((entry) => entry.status === "issued").length;
  const draftDeliverableCount = deliverables.filter((entry) => entry.status === "draft").length;
  const plannedMeetingCount = meetings.filter((meeting) => meeting.meeting_status === "planned").length;
  const unresolvedSiteItemCount = siteReports
    .filter(({ report }) => report.status === "draft")
    .flatMap(({ report }) => report.items)
    .filter((item) => item.kind === "issue" || item.kind === "follow-up")
    .length;
  const projectReadiness = buildProjectReadiness({
    dropboxLinked: Boolean(project.meta.dropbox_path),
    notionLinked: Boolean(project.meta.notion_page_id),
    scopeConfirmed: Boolean(details.scope.trim()),
    phaseCount: details.phases.length,
    contractCount: contractDocuments.length,
    primaryContractLinked: Boolean(details.contract_link_or_path.trim()),
    meetingCount: meetings.length,
    milestoneCount: schedule.milestones.length,
    reviewEvidenceCount:
      (records.qaqc?.items.length ?? 0) + records.reviews.length + records.markups.length,
  });
  const healthBadgeStatus = intelligence.healthEvidenceState === "unmeasured"
    ? "pending"
    : intelligence.healthEvidenceState === "partial"
      ? "warning"
      : HEALTH_BUCKET_STATUS[intelligence.healthBucket];
  const healthBadgeLabel = intelligence.healthEvidenceState === "unmeasured"
    ? "Health unmeasured"
    : intelligence.healthEvidenceState === "partial"
      ? "Partially measured"
      : `${intelligence.healthScore} health`;
  const notion = getNotionProjectMapEntry(project.meta.notion_page_id);
  const identity = resolveProjectIdentity(project.meta, details);
  const displayAddress = notion?.location || identity.address;
  const displayClient = notion?.client || identity.client;
  const nextMilestone = intelligence.nextUpcomingMilestone ?? intelligence.nextIncompleteMilestone;

  return (
    <div className="flex flex-col gap-6">
      {/*
        The hero answers "what is this and how is it doing" in one glance: identity on the
        left, the health score drawn on the right. The ring repeats the badge rather than
        replacing it -- the badge carries the words a screen reader and a colorblind reader
        need, the ring is the fast visual read for everyone else.
      */}
      <section className="project-hero surface-depth overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-start gap-5 p-5">
          <ProjectIdentity name={project.meta.name} slug={slug} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-light tracking-wide">{project.meta.name}</h1>
              <StatusBadge
                status={healthBadgeStatus}
                label={healthBadgeLabel}
                title={intelligence.healthExplanation}
              />
              <StatusBadge status={project.meta.status} />
            </div>
            {displayAddress && <p className="mt-1 text-muted-foreground">{displayAddress}</p>}
            <p className="text-sm text-muted-foreground">
              {displayClient && project.meta.client_id ? (
                <Link href={`/clients/${project.meta.client_id}`} className="hover:underline">
                  {displayClient}
                </Link>
              ) : (
                displayClient
              )}
              {project.meta.building_type ? ` · ${project.meta.building_type}` : ""}
              {project.meta.occupancy_group.length > 0
                ? ` · Occupancy ${project.meta.occupancy_group.join(", ")}`
                : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <ProjectStatusControl
                slug={slug}
                initialStatus={project.meta.status}
                notionLinked={Boolean(project.meta.notion_page_id)}
              />
              <OpenInNotionButton notionPageId={project.meta.notion_page_id} />
            </div>
          </div>
          <div className="shrink-0 rounded-lg border border-border bg-background/50 p-3">
            <HealthRing
              score={intelligence.healthScore}
              tone={HEALTH_RING_TONE[healthBadgeStatus] ?? "neutral"}
              measured={intelligence.healthEvidenceState === "measured"}
              label={intelligence.healthLabel}
              title={intelligence.healthExplanation}
            />
          </div>
        </div>
      </section>

      <ProjectBrief slug={slug} scope={details?.scope ?? ""} attention={intelligence.attentionReasons}
        nextMilestone={nextMilestone} decisions={decisions.map(record => record.decision)}
        knowledge={knowledge ? sortKnowledgeEntries(knowledge.entries) : []} />
      <ProjectDiscoveryPanel slug={slug} />
      {/* What this project is, before anything about what Mi can do to it. */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Project facts">
        <StatCard
          icon="calendar"
          label="Next milestone"
          tone={intelligence.overdueMilestones.length > 0 ? "danger" : "accent"}
          delayMs={0}
          value={nextMilestone
            ? <>{nextMilestone.name}<span className="mt-0.5 block font-mono text-xs text-muted-foreground">{nextMilestone.plannedDate}</span></>
            : <Unset>No upcoming milestone</Unset>}
          hint={intelligence.overdueMilestones.length > 0
            ? `${intelligence.overdueMilestones.length} overdue`
            : `${intelligence.milestoneHorizons.next7 + intelligence.milestoneHorizons.days8to30} due in 30 days`}
          action={nextMilestone ? undefined : { href: `/projects/${slug}/schedule`, label: "Plan a milestone" }}
        >
          <SegmentBar
            segments={[
              { key: "overdue", count: intelligence.milestoneHorizons.overdue, tone: "danger", label: "overdue" },
              { key: "next7", count: intelligence.milestoneHorizons.next7, tone: "warning", label: "due within 7 days" },
              { key: "days8to30", count: intelligence.milestoneHorizons.days8to30, tone: "accent", label: "due in 8-30 days" },
              { key: "later", count: intelligence.milestoneHorizons.days31to90 + intelligence.milestoneHorizons.later, tone: "neutral", label: "later" },
            ]}
          />
        </StatCard>

        <StatCard
          icon="budget"
          label="Fee"
          delayMs={60}
          value={details.fee === null
            ? <Unset>Not recorded</Unset>
            : <span className="tabular-nums">{details.fee.toLocaleString()} {details.fee_currency}</span>}
          hint={details.contract_link_or_path.trim()
            ? "Contract on file"
            : `${contractDocuments.length} contract document(s)`}
          action={details.fee === null ? { href: `/projects/${slug}/details`, label: "Record the fee" } : undefined}
        >
          {contractDocuments.length > 0 && (
            <CountPips filled={contractDocuments.length} total={contractDocuments.length} label="contract documents" />
          )}
        </StatCard>

        <StatCard
          icon="checklist"
          label="Scope"
          delayMs={120}
          value={details.scope.trim()
            ? <span className="line-clamp-2">{details.scope}</span>
            : <Unset>Scope not confirmed</Unset>}
          hint={`${details.phases.length} phase(s) planned`}
          action={details.scope.trim() ? undefined : { href: `/projects/${slug}/details`, label: "Confirm the scope" }}
        >
          {details.phases.length > 0 && (
            <CountPips filled={details.phases.length} total={details.phases.length} label="phases planned" />
          )}
        </StatCard>

        <StatCard
          icon="files"
          label="Shared sources"
          delayMs={180}
          value={
            <span className="flex flex-wrap gap-1.5">
              <SourceChip label="Notion" connected={intelligence.notionLinkState === "confirmed"} />
              <SourceChip label="Dropbox" connected={intelligence.dropboxLinkState === "confirmed"} />
            </span>
          }
          hint={`${intelligence.trackingCoverage.populated}/${intelligence.trackingCoverage.total} tracking areas populated`}
          action={intelligence.notionLinkState === "confirmed" && intelligence.dropboxLinkState === "confirmed"
            ? undefined
            : { href: `/projects/${slug}/details`, label: "Link shared sources" }}
        >
          <MiniMeter
            percent={intelligence.trackingCoverage.total === 0
              ? 0
              : (intelligence.trackingCoverage.populated / intelligence.trackingCoverage.total) * 100}
            label="of tracking areas populated"
          />
        </StatCard>
      </section>

      {intelligence.attentionReasons.length > 0 && (
        <section className="rounded-lg border border-status-warning/40 bg-card p-4" aria-labelledby="project-attention-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="project-attention-heading" className="flex items-center gap-2 font-medium">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-status-warning/40 bg-status-warning/10 text-status-warning">
                <AppIcon name="info" className="h-4 w-4" />
              </span>
              Needs attention
              <span className="rounded-full bg-status-warning/15 px-2 py-0.5 font-mono text-[11px] tabular-nums text-status-warning">
                {intelligence.attentionReasons.length}
              </span>
            </h2>
            <span className="text-xs text-muted-foreground">Derived from this project&apos;s own records.</span>
          </div>
          <ul className="mt-2.5 space-y-1.5 text-sm">
            {intelligence.attentionReasons.map((reason) => (
              <li key={reason.code} className="flex flex-wrap items-baseline gap-x-2 border-l-2 border-status-warning/35 pl-2.5">
                <span>{reason.label}</span>
                <span className="text-xs text-muted-foreground">{reason.source}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PendingApprovalsBanner approvals={pendingApprovals} />

      <PendingReviewPanel summary={reviewSummary} />

      {pendingProposalCount > 0 && (
        <AgentProposalInbox
          projectSlug={slug}
          notionLinked={Boolean(project.meta.notion_page_id)}
          initialRecords={agentProposalInbox}
          currentValues={{
            details,
            meta: {
              building_type: project.meta.building_type,
              occupancy_group: project.meta.occupancy_group,
            },
          }}
        />
      )}

      <ProjectMilestoneOverview
        slug={slug}
        milestones={getSchedule(slug, { includeArchived: true }).milestones}
        healthExplanation={intelligence.healthExplanation}
        scheduleHash={scheduleHash}
      />

      <section aria-labelledby="project-records-heading">
        <h2 id="project-records-heading" className="flex items-center gap-2 font-medium">
          <AppIcon name="files" className="h-4 w-4 text-accent" />
          Records
        </h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <RecordLink
            href={`/projects/${slug}/decisions`}
            label="Decision register"
            icon="decision"
            delayMs={0}
            count={decisions.length}
            hint={`${openDecisionCount} open · ${recentDecisionCount} decided in 30 days`}
          >
            {decisions.length > 0 && (
              <MiniMeter
                percent={((decisions.length - openDecisionCount) / decisions.length) * 100}
                label="decided"
              />
            )}
          </RecordLink>
          <RecordLink
            href={`/projects/${slug}/site-reports`}
            label="Site reports"
            icon="site"
            delayMs={50}
            count={siteReports.length}
            hint={`${draftSiteReportCount} draft · ${unresolvedSiteItemCount} open item(s)`}
          >
            <SegmentBar
              segments={[
                { key: "draft", count: draftSiteReportCount, tone: "warning", label: "draft" },
                { key: "final", count: siteReports.length - draftSiteReportCount, tone: "success", label: "final" },
              ]}
            />
          </RecordLink>
          <RecordLink
            href={`/projects/${slug}/deliverables`}
            label="Deliverables"
            icon="submissions"
            delayMs={100}
            count={deliverables.length}
            hint={`${issuedDeliverableCount} issued · ${draftDeliverableCount} draft`}
          >
            <SegmentBar
              segments={[
                { key: "issued", count: issuedDeliverableCount, tone: "success", label: "issued" },
                { key: "draft", count: draftDeliverableCount, tone: "warning", label: "draft" },
                { key: "other", count: Math.max(0, deliverables.length - issuedDeliverableCount - draftDeliverableCount), tone: "neutral", label: "other" },
              ]}
            />
          </RecordLink>
          <RecordLink
            href={`/projects/${slug}/meetings`}
            label="Meetings"
            icon="meeting"
            delayMs={150}
            count={meetings.length}
            hint={`${plannedMeetingCount} planned agenda(s)`}
          >
            {meetings.length > 0 && (
              <CountPips filled={meetings.length - plannedMeetingCount} total={meetings.length} label="meetings held" />
            )}
          </RecordLink>
          <RecordLink
            href={`/projects/${slug}/drawings`}
            label="Markups"
            icon="drawings"
            delayMs={200}
            count={markupResolution.total}
            hint={markupResolution.total > 0 ? `${markupResolution.percentResolved}% resolved` : "None indexed"}
          >
            {markupResolution.total > 0 && (
              <MiniMeter
                percent={markupResolution.percentResolved}
                tone={markupResolution.percentResolved >= 100 ? "success" : "accent"}
                label="resolved"
              />
            )}
          </RecordLink>
          <RecordLink
            href={`/projects/${slug}/schedule`}
            label="Milestones"
            icon="calendar"
            delayMs={250}
            count={schedule.milestones.length}
            hint={`${intelligence.overdueMilestones.length} overdue · ${intelligence.atRiskMilestones.length} at risk`}
          >
            <SegmentBar
              segments={[
                { key: "overdue", count: intelligence.overdueMilestones.length, tone: "danger", label: "overdue" },
                { key: "at-risk", count: intelligence.atRiskMilestones.length, tone: "warning", label: "at risk" },
                {
                  key: "on-track",
                  count: Math.max(0, schedule.milestones.length - intelligence.overdueMilestones.length - intelligence.atRiskMilestones.length),
                  tone: "success",
                  label: "on track",
                },
              ]}
            />
          </RecordLink>
        </div>
      </section>

      <section aria-labelledby="project-activity-heading">
        <h2 id="project-activity-heading" className="flex items-center gap-2 font-medium">
          <AppIcon name="history" className="h-4 w-4 text-accent" />
          Recent activity
        </h2>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-medium">Progress log</h3>
            {progressLog.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No progress log entries yet.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {progressLog.slice(0, 3).map((entry) => (
                  <li key={entry.slug}>
                    <div className="text-xs text-muted-foreground">
                      {entry.frontmatter.date} — {entry.frontmatter.author}
                    </div>
                    <div
                      className="prose prose-sm mt-1 line-clamp-4 max-w-none dark:prose-invert"
                      dangerouslySetInnerHTML={{ __html: entry.contentHtml }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-medium">Latest meetings</h3>
            {meetings.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No meeting records yet. <Link href={`/projects/${slug}/meetings`} className="text-link underline-offset-2 hover:underline">Add one</Link>.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {meetings.slice(0, 4).map((meeting) => (
                  <li key={`${meeting.date}-${meeting.id}`}>
                    <span className="font-medium">{meeting.title}</span>
                    <span className="text-xs text-muted-foreground"> · {meeting.date} · {meeting.meeting_type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/*
        Confirmed memory-note proposals append here. Rendering it is what makes a
        confirmed card observable: without this section the write lands in
        memory/notes.md and shows up nowhere in Mi.
      */}
      {/*
        A summary, not the contents. This used to print the first five sections in full,
        which on a project a few months in meant several screens of the overview were one
        append-only file -- and still no way to reach section six. The full, groupable,
        searchable view lives at /knowledge; this says what is in there and how fresh it is.
      */}
      {knowledge && knowledge.total > 0 && (
        <section id="project-memory" className="scroll-mt-6 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">Project knowledge</h2>
            <span className="text-xs text-muted-foreground">
              {knowledge.total} note{knowledge.total === 1 ? "" : "s"}
              {knowledge.lastUpdated ? ` · updated ${knowledge.lastUpdated}` : ""} · {knowledge.relativePath}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Durable facts confirmed from chat, a CLI agent proposal, or a review card.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {KNOWLEDGE_GROUPS.filter((group) => knowledge.counts[group] > 0).map((group) => (
              <Link
                key={group}
                href={`/projects/${slug}/knowledge`}
                className="tactile-control rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-accent hover:text-foreground"
              >
                {KNOWLEDGE_GROUP_LABELS[group]} <span className="opacity-70">{knowledge.counts[group]}</span>
              </Link>
            ))}
          </div>
          <ul className="mt-3 space-y-1">
            {sortKnowledgeEntries(knowledge.entries).slice(0, 3).map((entry) => (
              <li key={entry.id} className="truncate text-sm">
                <span className="text-muted-foreground">{entry.date ?? "—"}</span>{" "}
                {entry.title}
              </li>
            ))}
          </ul>
          <Link
            href={`/projects/${slug}/knowledge`}
            className="mt-3 inline-block text-sm text-link underline-offset-2 hover:underline"
          >
            Open all {knowledge.total} →
          </Link>
        </section>
      )}

      <details className="progressive-disclosure rounded-lg border border-border p-4">
        <summary className="cursor-pointer font-medium">Reviews, markups, MEP, and permits</summary>
        <div className="mt-4 flex flex-col gap-6">
          <section>
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-medium">Reviews</h3>
              {staleReviewCount > 0 && (
                <span className="text-xs text-muted-foreground">{staleReviewCount} stale (30+ days open)</span>
              )}
            </div>
            <ul className="mt-2 flex flex-col gap-3">
              {reviews.map((review) => (
                <li key={review.slug} className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{review.frontmatter.date}</span>
                    <span>· {review.frontmatter.discipline}</span>
                    <StatusBadge status={review.frontmatter.status} />
                  </div>
                  <div
                    className="prose prose-sm mt-1 max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: review.contentHtml }}
                  />
                  {review.frontmatter.related_code_sections.length > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Related codes: {review.frontmatter.related_code_sections.join(", ")}
                    </div>
                  )}
                </li>
              ))}
              {reviews.length === 0 && <EmptyNote text="No reviews yet." />}
            </ul>
          </section>

          <section>
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-medium">Markups</h3>
              {markupResolution.total > 0 && (
                <span className="text-xs text-muted-foreground">
                  {markupResolution.percentResolved}% resolved ({markupResolution.addressed}/{markupResolution.total})
                </span>
              )}
            </div>
            <ul className="mt-2 flex flex-col gap-2">
              {markups.map((markup) => (
                <li
                  key={`${markup.sheet}-${markup.revision}`}
                  className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
                >
                  <div>
                    <span className="font-medium">{markup.sheet} rev.{markup.revision}</span>{" "}
                    <span className="text-muted-foreground">— {markup.discipline} — {markup.date}</span>
                    {markup.notes && <div className="text-muted-foreground">{markup.notes}</div>}
                  </div>
                  <StatusBadge status={markup.status} />
                </li>
              ))}
              {markups.length === 0 && <EmptyNote text="No markups indexed yet." />}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-medium">MEP notes</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {mepNotes.map((doc) => (
                <div key={doc.slug} className="rounded-md border border-border p-3">
                  <div className="text-sm font-medium capitalize">{doc.slug}</div>
                  <div
                    className="prose prose-sm mt-1 max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: doc.contentHtml }}
                  />
                </div>
              ))}
              {mepNotes.length === 0 && <EmptyNote text="No MEP notes yet." />}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-medium">Permits</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {permits.map((permit) => (
                <li
                  key={permit.permit_type}
                  className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
                >
                  <span>{permit.permit_type}</span>
                  <StatusBadge status={permit.status} />
                </li>
              ))}
              {permits.length === 0 && <EmptyNote text="No permits tracked yet." />}
            </ul>
          </section>
        </div>
      </details>

      <details className="progressive-disclosure rounded-lg border border-border p-4">
        <summary className="cursor-pointer font-medium">Team, links, Notion data, and lessons</summary>
        <div className="mt-4 flex flex-col gap-6">
          {identity.team.length > 0 && (
            <section>
              <h3 className="text-sm font-medium">Team</h3>
              <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                {identity.team.map((member) => (
                  <li key={`${member.name}-${member.role}`}>{member.name} — {member.role}</li>
                ))}
              </ul>
            </section>
          )}

          {projectLinks.length > 0 && (
            <section>
              <h3 className="text-sm font-medium">Project links</h3>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {projectLinks.map((link) => (
                  <li key={link.url}>
                    <a href={link.url} target="_blank" rel="noreferrer" className="hover:underline">{link.label} ↗</a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {notion && (
            <section>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">Notion project data</h3>
                  <p className="text-xs text-muted-foreground">Pulled {notion.last_edited_time.slice(0, 10)}</p>
                </div>
                <NotionLink href={notion.notion_url} className="text-sm hover:underline">Open project in Notion ↗</NotionLink>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {notion.client && <div><dt className="text-muted-foreground">Client</dt><dd>{notion.client}</dd></div>}
                {notion.location && <div><dt className="text-muted-foreground">Location</dt><dd>{notion.location}</dd></div>}
                {notion.project_types.length > 0 && <div><dt className="text-muted-foreground">Project type</dt><dd>{notion.project_types.join(", ")}</dd></div>}
                {notion.scope.length > 0 && <div><dt className="text-muted-foreground">Scope</dt><dd>{notion.scope.join(", ")}</dd></div>}
                {notion.team.length > 0 && <div><dt className="text-muted-foreground">Team</dt><dd>{notion.team.join(", ")}</dd></div>}
                <div>
                  <dt className="text-muted-foreground">Reported hours</dt>
                  <dd className="mt-1 space-y-1">
                    <div><span className="text-muted-foreground">Total</span> · {formatHoursAndMinutes(notion.total_hours)}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Alex · {formatHoursAndMinutes(notion.hours_by_person.alex)}</span>
                      <span>Taylor · {formatHoursAndMinutes(notion.hours_by_person.taylor)}</span>
                    </div>
                  </dd>
                </div>
              </dl>
              {notion.schedule.entries.length > 0 && <NotionScheduleActivity entries={notion.schedule.entries} />}
            </section>
          )}

          {lessons && (
            <section>
              <h3 className="text-sm font-medium">Lessons learned</h3>
              <div
                className="prose prose-sm mt-2 max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: lessons.contentHtml }}
              />
            </section>
          )}
        </div>
      </details>

      <details className="progressive-disclosure rounded-lg border border-border p-4">
        <summary className="cursor-pointer font-medium">Health evidence, readiness, and workspace tools</summary>
        <div className="mt-4 flex flex-col gap-4">
          <section className="rounded-lg border border-border p-4" aria-labelledby="project-health-evidence-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id="project-health-evidence-heading" className="text-sm font-medium">Health evidence</h3>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{intelligence.healthExplanation}</p>
              </div>
              <Link
                href="/projects/analysis"
                className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Portfolio analysis
              </Link>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Evidence state</dt>
                <dd className="mt-1">{intelligence.healthLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Health-related tracking</dt>
                <dd className="mt-1">{intelligence.populatedHealthAreas.length}/6 populated areas</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Broader tracking coverage</dt>
                <dd className="mt-1">{intelligence.trackingCoverage.populated}/{intelligence.trackingCoverage.total} populated areas</dd>
              </div>
            </dl>
            <div className="mt-3 text-xs text-muted-foreground">
              Currently tracked: {intelligence.populatedTrackingAreas.length > 0
                ? intelligence.populatedTrackingAreas.map((area) => TRACKING_AREA_LABELS[area]).join(", ")
                : "No management tracking areas populated"}.
            </div>
          </section>

          <WorkflowReadiness
            title="Project delivery readiness"
            description="A compact check across shared files, commercial scope, meetings, scheduling, and drawing review. Missing items are prompts for review, never inferred values."
            baseHref={`/projects/${slug}`}
            items={projectReadiness}
          />

          <WorkspaceAnalysisPanel
            kind="project"
            slug={slug}
            initialAnalysis={readStoredAnalysis("project", slug)}
            nudge={analysisNudge("project", slug)}
          />
        </div>
      </details>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
