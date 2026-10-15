import fs from "node:fs";
import path from "node:path";
import type { Lead } from "@/lib/schema";
import {
  LEAD_FILE_KINDS,
  LEAD_FILE_KIND_LABEL,
  LEAD_HANDOFF_FILE,
  leadFileDestination,
  type LeadFileCopy,
  type LeadFileExclusion,
  type LeadFileKind,
  type LeadHandoffPlan,
} from "./leadHandoffPlan";
import { assertNoSymlinkOrReparsePoint, isPathInside, normalizeSafeRelativePath } from "./leadLibraryPathSafety";
import { getCommunications, getLeadDocuments, getLeadPhotos, getSiteVisits, leadDir } from "./leads";
import { getLeadMeetingNotes } from "./leadWorkspace";
import type { ProjectWorkflowProfile } from "./projectCreationPlan";

/**
 * Carries what Mi already knows about a lead into the Dropbox folder of the project it
 * becomes: one readable brief plus copies of the lead's indexed files. Everything here is
 * a copy -- the lead keeps its own records, and its separately linked Dropbox folder (a
 * human-confirmed path) is named in the brief, never moved, renamed, or duplicated.
 */

interface LeadHandoffOptions {
  workflow: ProjectWorkflowProfile;
  /** The reviewed folder list this project's Dropbox folder will actually get. */
  folders: string[];
  leadsDir?: string;
}

/** Indexed files per kind, as (file, label) pairs, in the order the lead records them. */
function indexedFiles(slug: string, kind: LeadFileKind, leadsDir?: string): { file: string; label: string }[] {
  if (kind === "site-photos") {
    return getLeadPhotos(slug, leadsDir).map((photo) => ({ file: photo.file, label: photo.caption }));
  }
  return getLeadDocuments(slug, kind, leadsDir).map((document) => ({ file: document.file, label: document.title }));
}

/**
 * Resolves one indexed file to a real path beneath its own lead subfolder. Index entries are
 * hand-edited YAML, so a traversing or symlinked path is possible and is excluded rather
 * than followed.
 */
function resolveLeadFile(root: string, file: string): string | null {
  try {
    const normalized = normalizeSafeRelativePath(file, "Lead file");
    assertNoSymlinkOrReparsePoint(root, normalized);
    const target = path.resolve(root, ...normalized.split("/"));
    if (!isPathInside(root, target)) return null;
    return target;
  } catch {
    return null;
  }
}

/**
 * Side-effect-free. Deterministic given the lead's files on disk, so the exact plan a person
 * reviews is the plan the confirm step re-derives and compares against.
 */
export function planLeadHandoff(slug: string, options: LeadHandoffOptions): LeadHandoffPlan {
  const root = leadDir(slug, options.leadsDir);
  const copies: LeadFileCopy[] = [];
  const excluded: LeadFileExclusion[] = [];

  for (const kind of LEAD_FILE_KINDS) {
    const destination = leadFileDestination(kind, options.workflow, options.folders);
    for (const { file, label } of indexedFiles(slug, kind, options.leadsDir)) {
      const source = resolveLeadFile(path.join(root, kind), file);
      if (!source) {
        excluded.push({ kind, source: `${kind}/${file}`, reason: "unsafe" });
        continue;
      }
      if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
        excluded.push({ kind, source: `${kind}/${file}`, reason: "missing" });
        continue;
      }
      const normalized = file.replaceAll("\\", "/");
      copies.push({
        kind,
        source: `${kind}/${normalized}`,
        target: `${destination}/${normalized}`,
        bytes: fs.statSync(source).size,
        label: label.trim(),
      });
    }
  }

  return {
    handoffFile: LEAD_HANDOFF_FILE,
    copies,
    excluded,
    totalBytes: copies.reduce((total, copy) => total + copy.bytes, 0),
    counts: {
      siteVisits: getSiteVisits(slug, options.leadsDir).length,
      correspondence: getCommunications(slug, options.leadsDir).length,
      meetings: getLeadMeetingNotes(slug, options.leadsDir).length,
      photos: copies.filter((copy) => copy.kind === "site-photos").length,
      ownerSupplied: copies.filter((copy) => copy.kind === "owner-supplied").length,
      contracts: copies.filter((copy) => copy.kind === "contracts").length,
    },
  };
}

function section(title: string, body: string[]): string[] {
  if (body.length === 0) return [];
  return [`## ${title}`, "", ...body, ""];
}

function fieldLines(lead: Lead, slug: string): string[] {
  const value = (input: string | number | null | undefined): string => {
    if (input === null || input === undefined || `${input}`.trim() === "") return "_not recorded_";
    return `${input}`;
  };
  return [
    `- **Lead record:** \`leads/${slug}/\``,
    `- **Source:** ${value(lead.source)}`,
    `- **Received:** ${value(lead.date_received)}`,
    `- **Pipeline status at conversion:** ${value(lead.status)}`,
    `- **Contact:** ${value(lead.contact_name)}`,
    `- **Email:** ${value(lead.contact_email)}`,
    `- **Phone:** ${value(lead.contact_phone)}`,
    `- **Referred by:** ${value(lead.referrer_name)}`,
    `- **Estimated value:** ${lead.estimated_value === null ? "_not recorded_" : `${lead.estimated_value}`}`,
    `- **Contract stage:** ${value(lead.contract_stage)}`,
    `- **Lead Dropbox folder:** ${lead.dropbox_path
      ? `\`${lead.dropbox_path}\` (left in place — nothing was copied out of it)`
      : "_none linked_"}`,
    `- **Notion lead page:** ${lead.notion_page_id ? "linked" : "_none_"}`,
  ];
}

interface MarkdownOptions extends LeadHandoffOptions {
  projectSlug: string;
  dropboxRelativePath: string;
  convertedDate: string;
}

/** The brief itself. Reports what the lead recorded; never fills a gap with a guess. */
export function buildLeadHandoffMarkdown(
  slug: string,
  lead: Lead,
  plan: LeadHandoffPlan,
  options: MarkdownOptions,
): string {
  const lines: string[] = [
    `# Lead handoff — ${lead.name}`,
    "",
    `Converted to Mi project \`${options.projectSlug}\` on ${options.convertedDate}, into`,
    `\`${options.dropboxRelativePath}\`. Written by Mi from the lead's own records; the lead`,
    "keeps everything below.",
    "",
    ...fieldLines(lead, slug),
    "",
  ];

  if (lead.notes?.trim()) lines.push(...section("Lead notes", [lead.notes.trim()]));
  if (lead.contract_notes.trim()) lines.push(...section("Contract notes", [lead.contract_notes.trim()]));

  const visits = getSiteVisits(slug, options.leadsDir);
  lines.push(...section(
    `Site visits (${visits.length})`,
    visits.flatMap((visit) => [
      `### ${visit.date}${visit.attendees.length > 0 ? ` — ${visit.attendees.join(", ")}` : ""}`,
      "",
      visit.notes.trim() || "_No notes recorded._",
      "",
    ]),
  ));

  const communications = getCommunications(slug, options.leadsDir);
  lines.push(...section(
    `Correspondence (${communications.length})`,
    communications.map((entry) => `- **${entry.date}** · ${entry.channel} — ${entry.summary}`),
  ));

  const meetings = getLeadMeetingNotes(slug, options.leadsDir);
  lines.push(...section(
    `Meetings (${meetings.length})`,
    meetings.flatMap((meeting) => {
      const body: string[] = [
        `### ${meeting.date} — ${meeting.title}`,
        "",
        `${meeting.meeting_type}${meeting.attendees.length > 0 ? ` · ${meeting.attendees.join(", ")}` : ""}`,
        "",
      ];
      if (meeting.objective.trim()) body.push(`**Objective:** ${meeting.objective.trim()}`, "");
      if (meeting.summary.trim()) body.push(meeting.summary.trim(), "");
      if (meeting.decisions.length > 0) {
        body.push("**Decisions:**", "", ...meeting.decisions.map((entry) => `- ${entry}`), "");
      }
      if (meeting.action_items.length > 0) {
        body.push(
          "**Action items:**",
          "",
          ...meeting.action_items.map((item) => `- ${item.description}${item.owner ? ` — ${item.owner}` : ""}`),
          "",
        );
      }
      if (meeting.open_questions.length > 0) {
        body.push("**Open questions:**", "", ...meeting.open_questions.map((entry) => `- ${entry}`), "");
      }
      return body;
    }),
  ));

  lines.push(...section("Files copied from the lead", LEAD_FILE_KINDS.flatMap((kind) => {
    const forKind = plan.copies.filter((copy) => copy.kind === kind);
    if (forKind.length === 0) return [];
    return [
      `### ${LEAD_FILE_KIND_LABEL[kind]} (${forKind.length})`,
      "",
      ...forKind.map((copy) => `- \`${copy.target}\`${copy.label ? ` — ${copy.label}` : ""}`),
      "",
    ];
  })));

  lines.push(...section(
    `Indexed but not copied (${plan.excluded.length})`,
    plan.excluded.map((entry) => `- \`${entry.source}\` — ${
      entry.reason === "missing" ? "indexed file was not found on disk" : "unsafe path in the lead's index"
    }`),
  ));

  return `${lines.join("\n").trimEnd()}\n`;
}

export interface LeadHandoffResult {
  written: string[];
  /** Targets that already existed. Nothing in a Dropbox folder is ever overwritten. */
  skipped: string[];
}

/**
 * Applies exactly the reviewed plan into an already-created project Dropbox folder.
 * Copies never overwrite: an existing target is reported as skipped instead.
 */
export function applyLeadHandoff(
  slug: string,
  targetDir: string,
  plan: LeadHandoffPlan,
  markdown: string,
  leadsDir?: string,
): LeadHandoffResult {
  const root = leadDir(slug, leadsDir);
  const written: string[] = [];
  const skipped: string[] = [];

  const handoffPath = path.join(targetDir, plan.handoffFile);
  if (fs.existsSync(handoffPath)) {
    skipped.push(plan.handoffFile);
  } else {
    fs.writeFileSync(handoffPath, markdown, "utf8");
    written.push(plan.handoffFile);
  }

  for (const copy of plan.copies) {
    const source = resolveLeadFile(root, copy.source);
    if (!source || !fs.existsSync(source)) {
      skipped.push(copy.target);
      continue;
    }
    const destination = path.resolve(targetDir, ...copy.target.split("/"));
    if (!isPathInside(targetDir, destination)) {
      skipped.push(copy.target);
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try {
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      written.push(copy.target);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      skipped.push(copy.target);
    }
  }

  return { written, skipped };
}
