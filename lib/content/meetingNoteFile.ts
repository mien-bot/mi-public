import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { dump as dumpYaml } from "js-yaml";
import { meetingNoteSchema, type MeetingNote } from "@/lib/schema";
import { ContentConflictError, hashContent, writeFileAtomically } from "./atomicContentWrite";
import { deleteFileRecoverably } from "./leadLibraryAtomicWrite";
import { isConflictedCopyName } from "./dropboxConflicts";

export interface MeetingNoteRecord {
  meeting: MeetingNote;
  hash: string;
}

export function readMeetingNoteRecords(directory: string): MeetingNoteRecord[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !isConflictedCopyName(entry.name))
    .map((entry) => {
      const content = fs.readFileSync(path.join(directory, entry.name), "utf8");
      return {
        meeting: meetingNoteSchema.parse(matter(content).data),
        hash: hashContent(content),
      };
    })
    .sort((a, b) =>
      `${b.meeting.date}T${b.meeting.start_time}`.localeCompare(`${a.meeting.date}T${a.meeting.start_time}`),
    );
}

function markdownList(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- None recorded";
}

function serializeMeetingNote(meeting: MeetingNote): string {
  const parsed = meetingNoteSchema.parse(meeting);
  const frontmatter = dumpYaml(parsed, { lineWidth: 100, noRefs: true }).trim();
  const actions = parsed.action_items.length
    ? parsed.action_items.map((item) =>
      `- [ ] ${item.description}${item.owner ? ` — ${item.owner}` : ""}${item.due_date ? ` (due ${item.due_date})` : ""}`,
    ).join("\n")
    : "- None recorded";
  const agenda = parsed.agenda_items.length
    ? parsed.agenda_items.map((item, index) =>
      `${index + 1}. **${item.topic}** — ${item.duration_minutes} minutes${item.desired_outcome ? `\n   - Desired outcome: ${item.desired_outcome}` : ""}`,
    ).join("\n")
    : "No agenda recorded.";
  return `---
${frontmatter}
---

# ${parsed.title}

## Objective

${parsed.objective || "No objective recorded."}

## Preparation

${markdownList(parsed.preparation)}

## Agenda

${agenda}

## Summary

${parsed.summary || "No summary recorded."}

## Decisions

${markdownList(parsed.decisions)}

## Action Items

${actions}

## Open Questions

${markdownList(parsed.open_questions)}

## Raw Notes

${parsed.raw_notes || "No raw notes recorded."}
`;
}

export function createMeetingNoteFile(directory: string, meeting: MeetingNote): string {
  const parsed = meetingNoteSchema.parse(meeting);
  const filePath = path.join(directory, `${parsed.date}-${parsed.id}.md`);
  writeFileAtomically(filePath, serializeMeetingNote(parsed), { expectedHash: null });
  return filePath;
}

export function updateMeetingNoteFile(
  directory: string,
  meeting: MeetingNote,
  expectedHash: string,
): string {
  const parsed = meetingNoteSchema.parse(meeting);
  const filePath = path.join(directory, `${parsed.date}-${parsed.id}.md`);
  writeFileAtomically(filePath, serializeMeetingNote(parsed), { expectedHash });
  return filePath;
}

/**
 * Removes one meeting note file.
 *
 * Shared by project meetings and lead meetings, which store the same records in different
 * directories — so both gain deletion from one implementation rather than two that could
 * drift. The note is copied into `.mi-backups/` before removal, and a stale hash is
 * refused so a page loaded before someone else's edit cannot discard it.
 *
 * Matching is by id rather than by rebuilding the filename from date+id: a note whose date
 * was edited after creation still lives under its original filename, and reconstructing the
 * path would silently fail to find it.
 */
export function deleteMeetingNoteRecord(
  directory: string,
  id: string,
  expectedHash: string,
): { meeting: MeetingNote; backupPath: string } {
  if (!fs.existsSync(directory)) throw new Error(`Meeting "${id}" was not found.`);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || isConflictedCopyName(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = meetingNoteSchema.safeParse(matter(content).data);
    if (!parsed.success || parsed.data.id !== id) continue;
    const currentHash = hashContent(content);
    if (currentHash !== expectedHash) {
      throw new ContentConflictError(filePath, expectedHash, currentHash);
    }
    const { backupPath } = deleteFileRecoverably(filePath);
    return { meeting: parsed.data, backupPath };
  }
  throw new Error(`Meeting "${id}" was not found.`);
}
