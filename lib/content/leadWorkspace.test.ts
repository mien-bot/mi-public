import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { meetingNoteSchema } from "@/lib/schema";
import { ContentConflictError } from "./atomicContentWrite";
import {
  getLeadMeetingNoteRecords,
  getLeadMeetingNotes,
  updateLeadMeetingNote,
  writeLeadMeetingNote,
} from "./leadWorkspace";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function meeting() {
  // Parsed so the fixture carries schema defaults and stays valid as fields are added.
  return meetingNoteSchema.parse({
    id: "site-visit",
    title: "Site visit",
    meeting_type: "Site Visit",
    meeting_status: "planned" as const,
    date: "2026-07-28",
    start_time: "10:00",
    end_time: "11:00",
    timezone: "America/Chicago",
    attendees: ["Alex"],
    objective: "Confirm existing conditions before the proposal.",
    preparation: ["Bring the field-measure kit."],
    agenda_items: [
      { topic: "Walk the space", duration_minutes: 45, desired_outcome: "Document open conditions." },
      { topic: "Client questions", duration_minutes: 15, desired_outcome: "Confirm priorities." },
    ],
    raw_notes: "Measured kitchen.",
    summary: "Existing kitchen measured.",
    decisions: [],
    action_items: [],
    open_questions: [],
  });
}

describe("lead meeting notes", () => {
  it("writes and reads a meeting inside the selected lead folder", () => {
    const leadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mi-lead-meeting-"));
    roots.push(leadsDir);
    fs.mkdirSync(path.join(leadsDir, "demo"), { recursive: true });

    const filePath = writeLeadMeetingNote("demo", meeting(), leadsDir);

    expect(filePath).toContain(path.join("demo", "meetings"));
    // Parsed rather than raw: reading a note applies meetingNoteSchema's defaults, so
    // comparing against the bare fixture would fail every time the schema gains a field.
    expect(getLeadMeetingNotes("demo", leadsDir)).toEqual([meetingNoteSchema.parse(meeting())]);
    const markdown = fs.readFileSync(filePath, "utf8");
    expect(markdown).toContain("## Preparation");
    expect(markdown).toContain("**Walk the space** — 45 minutes");
  });

  it("does not overwrite an existing meeting with the same date and id", () => {
    const leadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mi-lead-meeting-"));
    roots.push(leadsDir);
    fs.mkdirSync(path.join(leadsDir, "demo"), { recursive: true });
    writeLeadMeetingNote("demo", meeting(), leadsDir);

    expect(() => writeLeadMeetingNote("demo", meeting(), leadsDir)).toThrow();
  });

  it("completes a planned lead agenda in place with conflict protection", () => {
    const leadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mi-lead-meeting-"));
    roots.push(leadsDir);
    fs.mkdirSync(path.join(leadsDir, "demo"), { recursive: true });
    writeLeadMeetingNote("demo", meeting(), leadsDir);
    const [{ hash: staleHash }] = getLeadMeetingNoteRecords("demo", leadsDir);

    updateLeadMeetingNote(
      "demo",
      { ...meeting(), meeting_status: "completed", summary: "Visit completed and documented." },
      staleHash,
      leadsDir,
    );

    expect(getLeadMeetingNotes("demo", leadsDir)[0].meeting_status).toBe("completed");
    expect(fs.readdirSync(path.join(leadsDir, "demo", "meetings", ".mi-backups"))).toHaveLength(1);
    expect(() => updateLeadMeetingNote(
      "demo",
      { ...meeting(), meeting_status: "completed", summary: "Stale edit." },
      staleHash,
      leadsDir,
    )).toThrow(ContentConflictError);
    expect(getLeadMeetingNotes("demo", leadsDir)[0].summary).toBe("Visit completed and documented.");
  });
});
