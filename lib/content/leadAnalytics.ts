import fs from "node:fs";
import path from "node:path";
import type { CommunicationEntry, Lead, MeetingNote, SiteVisitEntry } from "@/lib/schema";
import {
  getCommunications,
  getAllLeads,
  getLead,
  getLeadDocuments,
  getLeadPhotos,
  getSiteVisits,
} from "./leads";
import { getLeadDropboxDir, listDropboxTree, type DropboxNode } from "./dropbox";
import { getLeadMeetingNotes } from "./leadWorkspace";

export interface LeadAnalysisSnapshot {
  slug: string;
  name: string;
  status: Lead["status"];
  estimatedValue: number | null;
  dateReceived: string;
  lastRecordedActivity: string;
  daysSinceRecordedActivity: number;
  integrations: {
    dropboxLinked: boolean;
    dropboxReachable: boolean;
    notionLinked: boolean;
  };
  counts: {
    meetings: number;
    siteVisits: number;
    correspondence: number;
    sitePhotos: number;
    contracts: number;
    ownerSupplied: number;
    dropboxFiles: number;
    dropboxFolders: number;
  };
  fileTypes: { extension: string; count: number }[];
  missingInformation: string[];
  attentionSignals: string[];
  briefing: string;
}

export interface LeadPipelineAnalysis {
  today: string;
  leads: LeadAnalysisSnapshot[];
  openLeads: number;
  recordedPipelineValue: number;
  withoutEstimate: number;
  withoutContact: number;
  dropboxLinked: number;
  notionLinked: number;
  statusCounts: { status: Lead["status"]; count: number }[];
  reviewQueue: LeadAnalysisSnapshot[];
  briefing: string;
}

interface LeadEvidence {
  slug: string;
  lead: Lead;
  meetings: MeetingNote[];
  visits: SiteVisitEntry[];
  communications: CommunicationEntry[];
  sitePhotoCount: number;
  contractCount: number;
  ownerSuppliedCount: number;
  dropboxTree: DropboxNode[];
  dropboxReachable: boolean;
  today?: string;
}

function calendarDaysBetween(from: string, to: string): number {
  const start = new Date(`${from}T12:00:00.000Z`).valueOf();
  const end = new Date(`${to}T12:00:00.000Z`).valueOf();
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function flattenDropbox(nodes: DropboxNode[]): DropboxNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenDropbox(node.children) : [])]);
}

function latestDate(values: string[], fallback: string): string {
  return values.filter(Boolean).reduce((latest, value) => value > latest ? value : latest, fallback);
}

export function analyzeLeadEvidence(evidence: LeadEvidence): LeadAnalysisSnapshot {
  const today = evidence.today ?? new Date().toISOString().slice(0, 10);
  const flatDropbox = flattenDropbox(evidence.dropboxTree);
  const files = flatDropbox.filter((entry) => !entry.isDirectory);
  const folders = flatDropbox.filter((entry) => entry.isDirectory);
  const typeCounts = new Map<string, number>();
  for (const file of files) {
    const extension = path.extname(file.name).toLowerCase() || "(no extension)";
    typeCounts.set(extension, (typeCounts.get(extension) ?? 0) + 1);
  }
  const fileTypes = [...typeCounts]
    .map(([extension, count]) => ({ extension, count }))
    .sort((a, b) => b.count - a.count || a.extension.localeCompare(b.extension));

  const hasContact = Boolean(
    evidence.lead.contact_name?.trim()
    || evidence.lead.contact_email?.trim()
    || evidence.lead.contact_phone?.trim(),
  );
  const missingInformation = [
    !hasContact ? "Owner or decision-maker contact" : "",
    evidence.lead.estimated_value === null ? "Estimated value" : "",
    !evidence.lead.dropbox_path ? "Confirmed Dropbox folder" : "",
    !evidence.lead.notion_page_id ? "Confirmed Notion page" : "",
    !evidence.lead.notes?.trim() ? "Lead notes or scope context" : "",
  ].filter(Boolean);

  const lastRecordedActivity = latestDate([
    ...evidence.meetings.map((meeting) => meeting.date),
    ...evidence.visits.map((visit) => visit.date),
    ...evidence.communications.map((entry) => entry.date),
  ], evidence.lead.date_received);
  const daysSinceRecordedActivity = calendarDaysBetween(lastRecordedActivity, today);
  const open = evidence.lead.status !== "won" && evidence.lead.status !== "lost";
  const attentionSignals = [
    open && daysSinceRecordedActivity >= 30
      ? `No recorded meeting, visit, or correspondence in ${daysSinceRecordedActivity} days`
      : "",
    open && evidence.communications.length === 0 ? "No correspondence is recorded" : "",
    open && !hasContact ? "No owner or decision-maker contact is recorded" : "",
    open && evidence.lead.estimated_value === null ? "No estimated value is recorded" : "",
    evidence.lead.status === "proposal-sent" && evidence.lead.contract_stage === "not-sent"
      ? "Pipeline says proposal sent, but contract stage is still Not Sent"
      : "",
    Boolean(evidence.lead.dropbox_path) && !evidence.dropboxReachable
      ? "The confirmed Dropbox folder is not reachable on this computer"
      : "",
  ].filter(Boolean);

  const evidenceSummary = [
    `${evidence.meetings.length} meeting${evidence.meetings.length === 1 ? "" : "s"}`,
    `${evidence.visits.length} site visit${evidence.visits.length === 1 ? "" : "s"}`,
    `${evidence.communications.length} correspondence entr${evidence.communications.length === 1 ? "y" : "ies"}`,
    `${files.length} Dropbox file${files.length === 1 ? "" : "s"}`,
  ].join(", ");
  const briefing = `${evidence.lead.name} is ${evidence.lead.status.replaceAll("-", " ")}. `
    + `The latest recorded activity is ${lastRecordedActivity} (${daysSinceRecordedActivity} day${daysSinceRecordedActivity === 1 ? "" : "s"} ago). `
    + `Current evidence: ${evidenceSummary}. `
    + (attentionSignals.length
      ? `Review ${attentionSignals.length} attention signal${attentionSignals.length === 1 ? "" : "s"} before the next follow-up.`
      : "No deterministic attention signal is present in the recorded fields.");

  return {
    slug: evidence.slug,
    name: evidence.lead.name,
    status: evidence.lead.status,
    estimatedValue: evidence.lead.estimated_value,
    dateReceived: evidence.lead.date_received,
    lastRecordedActivity,
    daysSinceRecordedActivity,
    integrations: {
      dropboxLinked: Boolean(evidence.lead.dropbox_path),
      dropboxReachable: evidence.dropboxReachable,
      notionLinked: Boolean(evidence.lead.notion_page_id),
    },
    counts: {
      meetings: evidence.meetings.length,
      siteVisits: evidence.visits.length,
      correspondence: evidence.communications.length,
      sitePhotos: evidence.sitePhotoCount,
      contracts: evidence.contractCount,
      ownerSupplied: evidence.ownerSuppliedCount,
      dropboxFiles: files.length,
      dropboxFolders: folders.length,
    },
    fileTypes,
    missingInformation,
    attentionSignals,
    briefing,
  };
}

export function buildLeadAnalysis(slug: string, today?: string): LeadAnalysisSnapshot {
  const { lead } = getLead(slug);
  const dropboxDir = getLeadDropboxDir(lead);
  const dropboxReachable = Boolean(
    dropboxDir && fs.existsSync(dropboxDir) && fs.statSync(dropboxDir).isDirectory(),
  );
  return analyzeLeadEvidence({
    slug,
    lead,
    meetings: getLeadMeetingNotes(slug),
    visits: getSiteVisits(slug),
    communications: getCommunications(slug),
    sitePhotoCount: getLeadPhotos(slug).length,
    contractCount: getLeadDocuments(slug, "contracts").length,
    ownerSuppliedCount: getLeadDocuments(slug, "owner-supplied").length,
    dropboxTree: dropboxReachable && dropboxDir ? listDropboxTree(dropboxDir) : [],
    dropboxReachable,
    today,
  });
}

const STATUS_ORDER: Lead["status"][] = [
  "new",
  "qualified",
  "proposal-sent",
  "on-hold",
  "won",
  "lost",
];

export function buildLeadPipelineAnalysis(today = new Date().toISOString().slice(0, 10)): LeadPipelineAnalysis {
  const leads = getAllLeads().map(({ slug }) => buildLeadAnalysis(slug, today));
  const open = leads.filter((lead) => lead.status !== "won" && lead.status !== "lost");
  const reviewQueue = open
    .filter((lead) => lead.attentionSignals.length > 0)
    .sort((a, b) =>
      b.attentionSignals.length - a.attentionSignals.length
      || b.daysSinceRecordedActivity - a.daysSinceRecordedActivity
      || a.name.localeCompare(b.name),
    );
  const statusCounts = STATUS_ORDER.map((status) => ({
    status,
    count: leads.filter((lead) => lead.status === status).length,
  }));
  const recordedPipelineValue = open.reduce((total, lead) => total + (lead.estimatedValue ?? 0), 0);
  const briefing = `${open.length} open lead${open.length === 1 ? "" : "s"} carry `
    + `$${recordedPipelineValue.toLocaleString()} in recorded estimated value. `
    + `${reviewQueue.length} open lead${reviewQueue.length === 1 ? "" : "s"} have deterministic attention signals; `
    + `${open.filter((lead) => lead.estimatedValue === null).length} have no estimate.`;

  return {
    today,
    leads,
    openLeads: open.length,
    recordedPipelineValue,
    withoutEstimate: open.filter((lead) => lead.estimatedValue === null).length,
    withoutContact: open.filter((lead) =>
      lead.missingInformation.includes("Owner or decision-maker contact"),
    ).length,
    dropboxLinked: leads.filter((lead) => lead.integrations.dropboxLinked).length,
    notionLinked: leads.filter((lead) => lead.integrations.notionLinked).length,
    statusCounts,
    reviewQueue,
    briefing,
  };
}
