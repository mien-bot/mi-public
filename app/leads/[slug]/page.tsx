import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentWorkspaceManager } from "@/components/AgentWorkspaceManager";
import { CommunicationLog } from "@/components/CommunicationLog";
import { ConvertLeadButton } from "@/components/ConvertLeadButton";
import { DeleteLeadButton } from "@/components/DeleteLeadButton";
import { LeadForm } from "@/components/LeadForm";
import { NotionLink } from "@/components/NotionLink";
import { PendingReviewPanel } from "@/components/PendingReviewPanel";
import { SiteVisitLog } from "@/components/SiteVisitLog";
import { StatusBadge } from "@/components/StatusBadge";
import { WorkflowReadiness } from "@/components/WorkflowReadiness";
import { WorkspaceAnalysisPanel } from "@/components/WorkspaceAnalysis";
import {
  getCommunications,
  getLeadDocuments,
  getLeadPhotos,
  getLeadMeetingNotes,
  getLeadSlugs,
  getLeadWithHash,
  getLastSiteVisitDate,
  getProjectSlugs,
  getSiteVisits,
} from "@/lib/content";
import { readWorkspaceReviewSummary } from "@/lib/content/reviewInboxService";
import { analysisNudge, readStoredAnalysis } from "@/lib/content/workspaceAnalysisStore";
import { buildLeadReadiness } from "@/lib/workflows/operationsReadiness";

export function generateStaticParams() {
  return getLeadSlugs().map((slug) => ({ slug }));
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

export default async function LeadDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getLeadSlugs().includes(slug)) notFound();
  const { lead, hash } = getLeadWithHash(slug);
  const siteVisits = getSiteVisits(slug);
  const communications = getCommunications(slug);
  const photos = getLeadPhotos(slug);
  const meetings = getLeadMeetingNotes(slug);
  const contractDocuments = getLeadDocuments(slug, "contracts");
  const reviewSummary = readWorkspaceReviewSummary("lead", slug);
  const lastVisit = getLastSiteVisitDate(slug);
  const completedMeetings = meetings.filter((meeting) => meeting.meeting_status === "completed");
  const blockingQuestions = meetings.flatMap((meeting) => meeting.blocking_questions);
  const leadReadiness = buildLeadReadiness({
    dropboxLinked: Boolean(lead.dropbox_path),
    notionLinked: Boolean(lead.notion_page_id),
    hasContact: Boolean(lead.contact_name?.trim() || lead.contact_email?.trim() || lead.contact_phone?.trim()),
    hasEstimate: lead.estimated_value !== null,
    contractStage: lead.contract_stage,
    contractCount: contractDocuments.length,
    siteVisitCount: siteVisits.length,
    communicationCount: communications.length,
    meetingCount: completedMeetings.length,
    blockingQuestionCount: blockingQuestions.length,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-light tracking-wide">{lead.name}</h1>
          <StatusBadge status={lead.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {lead.source} · Received {lead.date_received}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <Link href={`/leads/${slug}/meetings`} className="text-link underline hover:no-underline">Meetings</Link>
          <Link href={`/leads/${slug}/contracts`} className="text-link underline hover:no-underline">Contract drafts</Link>
          <Link href={`/leads/${slug}/owner-supplied`} className="text-link underline hover:no-underline">Owner-supplied information</Link>
          <Link href={`/leads/${slug}/dropbox`} className="text-link underline hover:no-underline">Dropbox files</Link>
        </div>
      </div>

      {/* The facts a person opens this page to check, before any control that changes them. */}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Lead facts">
        <Fact label="Owner contact">
          {lead.contact_name?.trim() || <span className="text-muted-foreground">Not recorded</span>}
          {lead.contact_email && <div className="text-xs text-muted-foreground">{lead.contact_email}</div>}
          {lead.contact_phone && <div className="text-xs text-muted-foreground">{lead.contact_phone}</div>}
        </Fact>
        <Fact label="Estimated value">
          {lead.estimated_value === null
            ? <span className="text-muted-foreground">Not estimated</span>
            : `$${lead.estimated_value.toLocaleString()}`}
          {lead.referrer_name && <div className="text-xs text-muted-foreground">Referred by {lead.referrer_name}</div>}
        </Fact>
        <Fact label="Contract stage">
          {lead.contract_stage}
          <div className="text-xs text-muted-foreground">
            {contractDocuments.length} document{contractDocuments.length === 1 ? "" : "s"} on file
          </div>
        </Fact>
        <Fact label="Last site visit">
          {lastVisit ?? <span className="text-muted-foreground">No visit logged</span>}
          <div className="text-xs text-muted-foreground">
            {completedMeetings.length} completed meeting{completedMeetings.length === 1 ? "" : "s"}
          </div>
        </Fact>
      </dl>

      {blockingQuestions.length > 0 && (
        <section className="rounded-lg border border-status-warning-foreground/40 bg-status-warning/20 p-4">
          <h2 className="font-medium">
            {blockingQuestions.length} blocking question{blockingQuestions.length === 1 ? "" : "s"} from meetings
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {blockingQuestions.slice(0, 5).map((question, index) => <li key={`${question}-${index}`}>{question}</li>)}
          </ul>
        </section>
      )}

      <PendingReviewPanel summary={reviewSummary} />

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Recent meetings</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirmed meeting records for this lead.
            </p>
          </div>
          <Link
            href={`/leads/${slug}/meetings`}
            className="tactile-control rounded-md bg-foreground px-3 py-2 text-sm text-background"
          >
            {meetings.length > 0 ? "Open meeting log" : "Add meeting"}
          </Link>
        </div>
        {meetings.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No meeting records yet.</p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {meetings.slice(0, 4).map((meeting) => (
              <article key={`${meeting.date}-${meeting.id}`} className="rounded-md border border-border p-3">
                <h3 className="text-sm font-medium">{meeting.title}</h3>
                <p className="text-xs text-muted-foreground">{meeting.date} · {meeting.meeting_type}</p>
                <p className="mt-2 line-clamp-3 text-sm">{meeting.summary || meeting.raw_notes || "No summary."}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <SiteVisitLog slug={slug} visits={siteVisits} />

      <CommunicationLog slug={slug} entries={communications} />

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-medium">Site photos <span className="ml-2 text-sm font-normal text-muted-foreground">{photos.length || ""}</span></h2>
        {photos.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No site photos indexed yet — drop files into leads/{slug}/site-photos/ then index them.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {photos.map((photo) => (
              <li key={photo.file} className="rounded-md border border-border p-3 text-sm">
                <a
                  href={`/api/lead-file/${slug}/site-photos/${encodeURIComponent(photo.file)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                >
                  {photo.file}
                </a>
                {photo.caption && <div className="text-muted-foreground">{photo.caption}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <WorkflowReadiness
        title="Lead workflow readiness"
        description="Tracks the usual path from owner intake and site visit through proposal, contract negotiation, and handoff. Google Drive contract links can be recorded in Contract notes."
        baseHref={`/leads/${slug}`}
        items={leadReadiness}
      />

      {lead.converted_project_slug ? (
        <section className="rounded-lg border border-border p-4">
          <h2 className="font-medium">Converted</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Converted to a project on {lead.converted_date}.
          </p>
          <Link href={`/projects/${lead.converted_project_slug}`} className="mt-2 inline-block text-sm text-link underline hover:no-underline">
            Open the resulting project ↗
          </Link>
        </section>
      ) : (
        <section className="rounded-lg border border-border p-4">
          <h2 className="font-medium">Convert to project</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Scaffolds a new project from this lead&apos;s name, contact, and estimated value, then links
            them together. This does not move or touch any real Dropbox files.
          </p>
          <div className="mt-3"><ConvertLeadButton slug={slug} name={lead.name} /></div>
        </section>
      )}

      {/*
        Everything below changes the record or the workspace rather than reporting on it.
        Folded away so the page opens on what this lead is, not on the controls for editing it.
      */}
      <details className="progressive-disclosure rounded-lg border border-border p-4">
        <summary className="cursor-pointer font-medium">Edit lead details</summary>
        <p className="mt-2 text-sm">
          {lead.notion_page_id ? (
            <NotionLink
              href={`https://www.notion.so/${lead.notion_page_id.replaceAll("-", "")}`}
              className="text-link underline hover:no-underline"
            >
              View in Notion ↗
            </NotionLink>
          ) : (
            <span className="text-muted-foreground">Not yet synced to Notion — save this lead to sync it.</span>
          )}
        </p>
        <div className="mt-3">
          <LeadForm mode="edit" slug={slug} initialLead={lead} initialHash={hash} projectSlugs={getProjectSlugs()} />
        </div>
      </details>

      <details className="progressive-disclosure rounded-lg border border-border p-4">
        <summary className="cursor-pointer font-medium">Workspace, analysis, and advanced</summary>
        <div className="mt-4 flex flex-col gap-4">
          <WorkspaceAnalysisPanel
            kind="lead"
            slug={slug}
            initialAnalysis={readStoredAnalysis("lead", slug)}
            nudge={analysisNudge("lead", slug)}
          />
          <AgentWorkspaceManager slug={slug} kind="lead" />
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">
              Removing this lead keeps a recoverable local backup of the whole lead folder. Notion and
              Dropbox are not changed.
            </p>
            <div className="mt-3">
              <DeleteLeadButton slug={slug} name={lead.name} convertedProjectSlug={lead.converted_project_slug} />
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
