import path from "node:path";
import type { MeetingNote } from "@/lib/schema";
import {
  createMeetingNoteFile,
  deleteMeetingNoteRecord,
  readMeetingNoteRecords,
  updateMeetingNoteFile,
} from "./meetingNoteFile";
import { leadDir } from "./leads";

function meetingDirectory(slug: string, leadsDir?: string): string {
  return path.join(leadDir(slug, leadsDir), "meetings");
}

export function getLeadMeetingNotes(slug: string, leadsDir?: string): MeetingNote[] {
  return getLeadMeetingNoteRecords(slug, leadsDir).map((record) => record.meeting);
}

export function getLeadMeetingNoteRecords(slug: string, leadsDir?: string) {
  return readMeetingNoteRecords(meetingDirectory(slug, leadsDir));
}

export function writeLeadMeetingNote(slug: string, meeting: MeetingNote, leadsDir?: string): string {
  return createMeetingNoteFile(meetingDirectory(slug, leadsDir), meeting);
}

export function updateLeadMeetingNote(
  slug: string,
  meeting: MeetingNote,
  expectedHash: string,
  leadsDir?: string,
): string {
  return updateMeetingNoteFile(meetingDirectory(slug, leadsDir), meeting, expectedHash);
}

/**
 * Removes a lead meeting note. Shares deleteMeetingNoteRecord with project meetings, so the
 * hash guard and the recoverable `.mi-backups/` copy behave identically on both sides.
 */
export function deleteLeadMeetingNote(
  slug: string,
  id: string,
  expectedHash: string,
  leadsDir?: string,
): { meeting: MeetingNote; backupPath: string } {
  return deleteMeetingNoteRecord(meetingDirectory(slug, leadsDir), id, expectedHash);
}
