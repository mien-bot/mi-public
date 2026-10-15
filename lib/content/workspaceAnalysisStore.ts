import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { MeetingNote } from "@/lib/schema";
import { writeFileAtomically } from "./atomicContentWrite";
import { getLead } from "./leads";
import { getLeadMeetingNotes } from "./leadWorkspace";
import { getPermitQaqcEngagement } from "./permitQaqc";
import { getProject } from "./projects";
import { getMeetingNotes } from "./projectWorkspace";
import {
  buildWorkspaceAnalysis,
  compareAnalyses,
  type AnalysisComparison,
  type AnalysisSubject,
  type WorkspaceAnalysis,
} from "./workspaceAnalysis";
import {
  diffFolderScan,
  readFolderIndex,
  scanWorkspaceFolder,
  writeFolderIndex,
} from "./workspaceFolderScan";
import { buildKnowledgeFiles, writeKnowledgeFiles, type KnowledgeWriteResult } from "./workspaceKnowledge";
import { readWorkspaceOutbox, resolveWorkspace, type WorkspaceKind } from "./workspaceOutbox";

/**
 * The subject each workspace type presents to the analysis engine.
 *
 * Every field listed here is one the detectors may contradict or call stale, so only
 * human-confirmed structured data belongs in it. Derived or generated values would show up
 * as disagreements with themselves.
 */
export function analysisSubject(kind: WorkspaceKind, slug: string): AnalysisSubject {
  if (kind === "lead") {
    const { lead } = getLead(slug);
    return {
      kind,
      slug,
      label: lead.name,
      fields: {
        status: lead.status,
        estimated_value: lead.estimated_value === null ? null : String(lead.estimated_value),
        contract_stage: lead.contract_stage,
        contact_name: lead.contact_name?.trim() || null,
        notion_page_id: lead.notion_page_id ?? null,
        dropbox_path: lead.dropbox_path ?? null,
      },
      anchorDate: lead.date_received || null,
    };
  }
  if (kind === "project") {
    const project = getProject(slug);
    return {
      kind,
      slug,
      label: project.meta.name,
      fields: {
        status: project.meta.status,
        client: project.meta.client?.trim() || null,
        building_type: project.meta.building_type,
        occupancy_group: project.meta.occupancy_group.length ? project.meta.occupancy_group.join(", ") : null,
        notion_page_id: project.meta.notion_page_id ?? null,
        dropbox_path: project.meta.dropbox_path ?? null,
      },
      anchorDate: project.meta.start_date || null,
    };
  }
  const record = getPermitQaqcEngagement(slug);
  return {
    kind,
    slug,
    label: record.engagement.name,
    fields: {
      status: record.engagement.status,
      submitting_firm: record.engagement.submitting_firm?.trim() || null,
      dropbox_path: record.engagement.dropbox_path ?? null,
    },
    anchorDate: null,
  };
}

/** Permit QA/QC has no meeting log of its own yet, so it analyzes entries and files only. */
function meetingsFor(kind: WorkspaceKind, slug: string): MeetingNote[] {
  try {
    if (kind === "lead") return getLeadMeetingNotes(slug);
    if (kind === "project") return getMeetingNotes(slug);
    return [];
  } catch {
    return [];
  }
}

const storedAnalysisSchema = z.object({
  version: z.literal(1),
  workspace: z.object({ type: z.enum(["lead", "project", "permit-qaqc"]), slug: z.string() }),
  ranAt: z.string().datetime(),
  folderRead: z.boolean(),
  folderNote: z.string(),
  standing: z.string(),
  blockers: z.array(z.unknown()),
  contradictions: z.array(z.unknown()),
  staleness: z.array(z.unknown()),
  openQuestions: z.array(z.unknown()),
  actionItems: z.array(z.unknown()),
  missing: z.array(z.string()),
  newFiles: z.array(z.string()),
  signature: z.string(),
});

function analysisPath(kind: WorkspaceKind, slug: string): string {
  return path.join(resolveWorkspace(kind, slug).recordDir, ".mi", "analysis.json");
}

export function readStoredAnalysis(kind: WorkspaceKind, slug: string): WorkspaceAnalysis | null {
  try {
    const filePath = analysisPath(kind, slug);
    if (!fs.existsSync(filePath)) return null;
    const parsed = storedAnalysisSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    return parsed as unknown as WorkspaceAnalysis;
  } catch {
    return null;
  }
}

export interface AnalysisRun {
  analysis: WorkspaceAnalysis;
  comparison: AnalysisComparison;
  previousRanAt: string | null;
  /** Regenerated workspace views, so a later terminal session starts from this run. */
  knowledge: KnowledgeWriteResult[];
}

/**
 * One Analyze pass.
 *
 * Read-only against every record: it reads meetings, outbox entries, and the Dropbox
 * folder, and the only things it writes are Mi's own two bookkeeping files -- the analysis
 * snapshot and the folder seen-index. Findings become review cards a person confirms;
 * nothing here touches lead.yaml, project.yaml, schedule, or memory/notes.md.
 */
export function runWorkspaceAnalysis(
  kind: WorkspaceKind,
  slug: string,
  options: { now?: () => Date; persist?: boolean } = {},
): AnalysisRun {
  const now = options.now ?? (() => new Date());
  const ranAt = now().toISOString();
  const today = ranAt.slice(0, 10);

  const scan = scanWorkspaceFolder(kind, slug);
  const changes = diffFolderScan(scan, readFolderIndex(kind, slug));
  const previous = readStoredAnalysis(kind, slug);
  const subject = analysisSubject(kind, slug);
  const meetings = meetingsFor(kind, slug);
  const entries = readWorkspaceOutbox(kind, slug).pending.map((record) => record.entry);

  const analysis = buildWorkspaceAnalysis({
    subject,
    meetings,
    entries,
    files: scan.status === "scanned" ? scan.files : [],
    folder: {
      status: scan.status,
      reason: scan.status === "unreachable" ? scan.reason : undefined,
      ...changes,
    },
    today,
  }, ranAt);

  const comparison = compareAnalyses(previous, analysis);

  let knowledge: KnowledgeWriteResult[] = [];
  if (options.persist !== false) {
    // Derived bookkeeping: regenerated by the next run, so backing it up only accumulates
    // files in the firm's shared folder.
    writeFileAtomically(analysisPath(kind, slug), `${JSON.stringify(analysis, null, 2)}\n`, { backup: false });
    // Only after a successful analysis: recording the index first would mark files as seen
    // even if the pass failed, and they would never be reported as new again.
    if (scan.status === "scanned") writeFolderIndex(kind, slug, scan, now);

    /*
     * Regenerating the workspace views is part of Analyze rather than a second button.
     * Two actions that both mean "make this current" is how one of them stops being
     * pressed. A failure here must not lose the analysis that already succeeded, so it is
     * reported rather than thrown.
     */
    try {
      knowledge = writeKnowledgeFiles(
        kind,
        slug,
        buildKnowledgeFiles({ kind, slug, label: subject.label, meetings, entries, generatedAt: ranAt }),
      );
    } catch {
      knowledge = [];
    }
  }

  return { analysis, comparison, previousRanAt: previous?.ranAt ?? null, knowledge };
}

export interface AnalysisNudge {
  lastRanAt: string | null;
  /** Files seen in the folder that the last recorded scan had not indexed. */
  newFileCount: number;
  folderRead: boolean;
  pendingEntryCount: number;
  /** True when the newest meeting postdates the last Analyze run. */
  meetingsSinceLastRun: number;
  reasons: string[];
}

/**
 * The cheap signal shown beside the button, computed on page load.
 *
 * Deliberately not a full pass: Analyze regenerates context files and may call an AI
 * engine, which is far too much work to do on every navigation. This reads the two small
 * bookkeeping files and stats the folder, so the button can say why it is worth pressing
 * without the cost of pressing it.
 */
export function analysisNudge(kind: WorkspaceKind, slug: string): AnalysisNudge {
  const previous = readStoredAnalysis(kind, slug);
  const scan = scanWorkspaceFolder(kind, slug);
  const changes = diffFolderScan(scan, readFolderIndex(kind, slug));
  const pending = readWorkspaceOutbox(kind, slug).pending;

  const lastRanAt = previous?.ranAt ?? null;
  const meetings = meetingsFor(kind, slug).filter((meeting) => meeting.meeting_status === "completed");
  const meetingsSince = lastRanAt
    ? meetings.filter((meeting) => `${meeting.date}T23:59:59.999Z` > lastRanAt).length
    : meetings.length;

  const reasons: string[] = [];
  if (!lastRanAt) reasons.push("never analyzed");
  if (changes.added.length > 0) reasons.push(`${changes.added.length} new file(s)`);
  if (changes.changed.length > 0) reasons.push(`${changes.changed.length} changed file(s)`);
  if (pending.length > 0) reasons.push(`${pending.length} pending session entr${pending.length === 1 ? "y" : "ies"}`);
  if (meetingsSince > 0) reasons.push(`${meetingsSince} meeting(s) since the last run`);
  if (scan.status === "unreachable") reasons.push("the folder could not be read");

  return {
    lastRanAt,
    newFileCount: changes.added.length,
    folderRead: scan.status === "scanned",
    pendingEntryCount: pending.length,
    meetingsSinceLastRun: meetingsSince,
    reasons,
  };
}
