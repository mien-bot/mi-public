import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import {
  projectDetailsSchema,
  reviewFrontmatterSchema,
  scheduleSchema,
  type Discipline,
  type MeetingNote,
  type Milestone,
  type ProjectDetails,
  type ReviewStatus,
} from "@/lib/schema";
import { getProjectDropboxDir } from "./dropbox";
import { readCurrentHash, writeFileAtomically, type AtomicWriteOptions } from "./atomicContentWrite";
import { createMeetingNoteFile, deleteMeetingNoteRecord, readMeetingNoteRecords, updateMeetingNoteFile } from "./meetingNoteFile";
import { contentDir, getProjectWithHash, getSchedule, schedulePath, writeProjectMeta } from "./projects";
import { projectMetaIdentityMirror } from "./projectIdentity";
import type { ProjectMeta } from "@/lib/schema";

export function projectDetailsPath(slug: string): string {
  return path.join(contentDir(slug), "details.yaml");
}

export function getProjectDetails(slug: string): ProjectDetails {
  const filePath = projectDetailsPath(slug);
  if (!fs.existsSync(filePath)) return projectDetailsSchema.parse({});
  return projectDetailsSchema.parse(loadYaml(fs.readFileSync(filePath, "utf8")) ?? {});
}

/**
 * Same as getProjectDetails, plus the file's current hash -- for edit forms to capture at
 * read time and echo back as expectedHash on save, so a concurrent edit (another Mi
 * instance sharing this project's Dropbox-migrated content) is detected instead of
 * silently overwritten. Kept as a sibling rather than changing getProjectDetails' return
 * shape, since that function has many other callers that don't need the hash.
 */
export function getProjectDetailsWithHash(slug: string): { details: ProjectDetails; hash: string | null } {
  return { details: getProjectDetails(slug), hash: readCurrentHash(projectDetailsPath(slug)) };
}

/**
 * Writes details.yaml and mirrors address / client / team back into project.yaml.
 *
 * The mirror is what keeps the two records from disagreeing about the same fact.
 * It is deliberately best-effort and runs *after* the details write: project.yaml
 * is a per-machine registry, and a project whose registry entry is momentarily
 * unwritable (read-only checkout, a concurrent edit losing the hash check) must
 * not lose the details write the person just confirmed. A failed mirror leaves
 * the fallback stale, which resolveProjectIdentity already handles, rather than
 * failing the whole save.
 */
export function writeProjectDetails(slug: string, details: ProjectDetails, options: AtomicWriteOptions = {}): void {
  const parsed = projectDetailsSchema.parse(details);
  writeFileAtomically(projectDetailsPath(slug), dumpYaml(parsed, { lineWidth: 100, noRefs: true }), options);

  try {
    const { project, hash } = getProjectWithHash(slug);
    const mirror = projectMetaIdentityMirror(project.meta, parsed);
    if (mirror) writeProjectMeta(slug, { ...project.meta, ...mirror }, { expectedHash: hash });
  } catch {
    // See above: the details record is saved either way.
  }
}

export function writeProjectSchedule(slug: string, milestones: Milestone[], options: AtomicWriteOptions = {}): void {
  const parsed = scheduleSchema.parse({ milestones });
  writeFileAtomically(
    schedulePath(slug),
    dumpYaml(parsed, { lineWidth: 100, noRefs: true }),
    options,
  );
}

/**
 * Removes one milestone from the schedule.
 *
 * The schedule is a single YAML document, so this is a filter plus an atomic rewrite under
 * the file's hash rather than a file deletion. A milestone that came from Notion is
 * refused: Mi's copy is a mirror of a row that still exists over there, and silently
 * dropping it here would make the next sync look like a mysterious re-appearance. Unlink
 * or remove it in Notion first.
 */
export function deleteProjectMilestone(
  slug: string,
  id: string,
  expectedHash: string | null,
): Milestone {
  const current = getSchedule(slug, { includeArchived: true }).milestones;
  const existing = current.find((milestone) => milestone.id === id);
  if (!existing) throw new Error(`Milestone "${id}" was not found.`);
  if (existing.notion_event_id) {
    throw new Error(
      "This milestone is linked to a Notion schedule row. Remove it in Notion first, or the next sync will bring it straight back.",
    );
  }
  writeProjectSchedule(
    slug,
    current.filter((milestone) => milestone.id !== id),
    { expectedHash },
  );
  return existing;
}

function meetingDirectory(slug: string): string {
  return path.join(contentDir(slug), "meetings");
}

export function getMeetingNotes(slug: string): MeetingNote[] {
  return getMeetingNoteRecords(slug).map((record) => record.meeting);
}

export function getMeetingNoteRecords(slug: string) {
  return readMeetingNoteRecords(meetingDirectory(slug));
}

export function writeMeetingNote(slug: string, meeting: MeetingNote): string {
  return createMeetingNoteFile(meetingDirectory(slug), meeting);
}

export function updateMeetingNote(slug: string, meeting: MeetingNote, expectedHash: string): string {
  return updateMeetingNoteFile(meetingDirectory(slug), meeting, expectedHash);
}

/**
 * Removes a project meeting note. A meeting recorded against the wrong project, or a
 * duplicate from a double-submit, previously had no way back out. Recoverable: the file is
 * copied into `.mi-backups/` before it is removed.
 */
export function deleteMeetingNote(
  slug: string,
  id: string,
  expectedHash: string,
): { meeting: MeetingNote; backupPath: string } {
  return deleteMeetingNoteRecord(meetingDirectory(slug), id, expectedHash);
}

export function memoryNotesPath(slug: string): string {
  return path.join(contentDir(slug), "memory", "notes.md");
}

export interface ProjectMemorySection {
  title: string;
  body: string;
}

export interface ProjectMemory {
  lastUpdated: string | null;
  sections: ProjectMemorySection[];
  /** Prose before the first `## ` heading, e.g. a hand-written preamble. */
  preamble: string;
  relativePath: string;
}

/**
 * Reads back what confirmed memory-note proposals write. Without a reader, an
 * applied memory note lands on disk and appears nowhere in Mi, which reasonably
 * looks to the person who confirmed it like the card did nothing.
 *
 * Splits on `## ` headings to match the shape appendMemoryNoteFile writes; a
 * hand-authored file that uses other structure still renders, as preamble.
 */
export function getProjectMemory(slug: string): ProjectMemory | null {
  const filePath = memoryNotesPath(slug);
  if (!fs.existsSync(filePath)) return null;
  const parsed = matter(fs.readFileSync(filePath, "utf8"));
  const lastUpdated = typeof parsed.data?.last_updated === "string" ? parsed.data.last_updated : null;
  const content = parsed.content.trim();
  if (!content) return null;

  const sections: ProjectMemorySection[] = [];
  const lines = content.split(/\r?\n/);
  const preambleLines: string[] = [];
  let current: ProjectMemorySection | null = null;
  for (const line of lines) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      if (current) sections.push({ ...current, body: current.body.trim() });
      current = { title: heading[1].trim(), body: "" };
      continue;
    }
    if (current) current.body += `${line}\n`;
    else preambleLines.push(line);
  }
  if (current) sections.push({ ...current, body: current.body.trim() });

  return {
    lastUpdated,
    sections,
    preamble: preambleLines.join("\n").trim(),
    relativePath: path.join("memory", "notes.md"),
  };
}

/**
 * Appends a `## title` section to this project's memory/notes.md, creating the file if it
 * doesn't exist yet. Preserves every existing section (read-modify-write on the body,
 * frontmatter's last_updated bumped to today) -- confirmed chat proposals are the only
 * writer, per lib/agentContext.ts's "never modify it directly from chat; propose a reviewed
 * update instead". Matches the frontmatter/heading shape of hand-authored memory files
 * (see e.g. projects/example-project-59/memory/notes.md) rather than inventing a new one.
 *
 * Captures the file's hash at the same moment as the read below and re-checks it at write
 * time (unless the caller explicitly overrides expectedHash) -- no chat UI captures a hash
 * further upstream the way the project-details/schedule editors do, so this closes the race
 * to this function's own read-modify-write window instead of leaving it fully unchecked. That
 * matters most for two machines both confirming a memory-note proposal for the same
 * Dropbox-shared project around the same time.
 */
export function appendProjectMemoryNote(
  slug: string,
  note: { title: string; entry: string },
  options: AtomicWriteOptions = {},
): string {
  return appendMemoryNoteFile(memoryNotesPath(slug), note, options);
}

/** Shared serializer for confirmed local and Dropbox agent-memory appends. */
export function appendMemoryNoteFile(
  filePath: string,
  note: { title: string; entry: string },
  options: AtomicWriteOptions = {},
): string {
  const hashAtRead = readCurrentHash(filePath);
  const existingBody = fs.existsSync(filePath) ? matter(fs.readFileSync(filePath, "utf8")).content.trim() : "";
  const section = `## ${note.title.trim()}\n\n${note.entry.trim()}`;
  const body = [existingBody, section].filter(Boolean).join("\n\n");
  const frontmatter = dumpYaml(
    { last_updated: new Date().toISOString().slice(0, 10) },
    { lineWidth: 100, noRefs: true },
  ).trim();
  writeFileAtomically(filePath, `---\n${frontmatter}\n---\n\n${body}\n`, {
    ...options,
    expectedHash: options.expectedHash !== undefined ? options.expectedHash : hashAtRead,
  });
  return filePath;
}

function reviewsDirectory(slug: string): string {
  return path.join(contentDir(slug), "reviews");
}

export interface ReviewFindingDraft {
  id: string;
  title: string;
  discipline: Discipline;
  status: ReviewStatus;
  related_markups: string[];
  related_code_sections: string[];
  finding: string;
  recommendation: string;
}

/**
 * Writes a confirmed AI review finding to reviews/<date>-<id>.md, in the exact
 * reviewFrontmatterSchema shape lib/content/projects.ts's getReviews already reads --
 * see lib/content/permitQaqc.ts's getPermitQaqcReviews doc comment for why this reuses
 * that shape rather than inventing a parallel one. `date` is stamped as today server-side
 * (the day the human confirmed it), not model-supplied, matching appendProjectMemoryNote's
 * last_updated handling.
 */
export function writeReviewFinding(slug: string, draft: ReviewFindingDraft): string {
  const date = new Date().toISOString().slice(0, 10);
  const frontmatter = reviewFrontmatterSchema.parse({
    date,
    type: "review",
    discipline: draft.discipline,
    status: draft.status,
    related_markups: draft.related_markups,
    related_code_sections: draft.related_code_sections,
  });
  const dir = reviewsDirectory(slug);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${date}-${draft.id}.md`);
  const yaml = dumpYaml(frontmatter, { lineWidth: 100, noRefs: true }).trim();
  const markdown = `---\n${yaml}\n---\n\n# ${draft.title}\n\n## Finding\n\n${draft.finding.trim()}\n\n## Recommendation\n\n${draft.recommendation.trim() || "None recorded."}\n`;
  // Two confirmed review-finding proposals on the same project, same day, that happen to share
  // an id (plausible with multiple open chat tabs on the same project) would otherwise silently
  // overwrite each other -- expectedHash: null means "must not already exist", same as
  // createLead/createPermitQaqcEngagement's collision checks elsewhere.
  writeFileAtomically(filePath, markdown, { expectedHash: null });
  return filePath;
}

export interface DropboxContractCandidate {
  name: string;
  relative_path: string;
  modified_at: string;
}

const CONTRACT_PATTERN = /(contract|agreement|proposal|engagement|scope|fee|aia|owner.?architect)/i;
const DOCUMENT_PATTERN = /\.(pdf|docx?|xlsx?|rtf|txt)$/i;

/** Metadata-only, bounded search. It never reads, copies, or modifies Dropbox file contents. */
export function discoverDropboxContractCandidates(meta: ProjectMeta): DropboxContractCandidate[] {
  const projectDir = getProjectDropboxDir(meta);
  if (!projectDir || !fs.existsSync(projectDir)) return [];
  const rootDir = projectDir;
  const candidates: DropboxContractCandidate[] = [];
  let visited = 0;

  function walk(dir: string, depth: number) {
    if (depth > 5 || visited >= 1500) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (visited++ >= 1500 || entry.name.startsWith(".")) break;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, depth + 1);
      } else if (CONTRACT_PATTERN.test(entry.name) && DOCUMENT_PATTERN.test(entry.name)) {
        const stat = fs.statSync(absolute);
        candidates.push({
          name: entry.name,
          relative_path: path.relative(rootDir, absolute).split(path.sep).join("/"),
          modified_at: stat.mtime.toISOString(),
        });
      }
    }
  }

  walk(rootDir, 0);
  return candidates.sort((a, b) => b.modified_at.localeCompare(a.modified_at)).slice(0, 100);
}
