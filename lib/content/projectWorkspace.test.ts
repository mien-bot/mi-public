import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-project-workspace-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

let projectDir: string;
vi.mock("./projects", async () => {
  const nodeFs = await import("node:fs");
  const nodePath = await import("node:path");
  const yaml = await import("js-yaml");
  const contentDir = () => projectDir;
  const schedulePath = () => nodePath.join(projectDir, "schedule", "schedule.yaml");
  return {
    contentDir,
    schedulePath,
    // Faithful to the real accessor: an absent file is an empty schedule, not an error.
    getSchedule: () => (nodeFs.existsSync(schedulePath())
      ? yaml.load(nodeFs.readFileSync(schedulePath(), "utf8")) as { milestones: unknown[] }
      : { milestones: [] }),
  };
});

import { meetingNoteSchema } from "@/lib/schema";
import { ContentConflictError, readCurrentHash } from "./atomicContentWrite";
import { getSchedule } from "./projects";
import {
  appendProjectMemoryNote,
  deleteMeetingNote,
  deleteProjectMilestone,
  getMeetingNoteRecords,
  getMeetingNotes,
  getProjectMemory,
  updateMeetingNote,
  writeMeetingNote,
  writeProjectSchedule,
  writeReviewFinding,
} from "./projectWorkspace";

/**
 * Round-trips the write path against the read path. These two drifting apart is
 * exactly the failure that made four confirmed memory-note cards look like
 * no-ops: they were written correctly and nothing in Mi could show them.
 */
describe("getProjectMemory", () => {
  it("returns null before anything has been recorded", () => {
    projectDir = temporaryRoot();
    expect(getProjectMemory("demo")).toBeNull();
  });

  it("reads back every note appended by a confirmed proposal", () => {
    projectDir = temporaryRoot();
    appendProjectMemoryNote("demo", { title: "Confirmed address", entry: "The address is 1002 S Example Blvd." });
    appendProjectMemoryNote("demo", { title: "Anchor moved", entry: "NOF Q4 closes 2026-11-13." });

    const memory = getProjectMemory("demo");
    expect(memory?.sections).toEqual([
      { title: "Confirmed address", body: "The address is 1002 S Example Blvd." },
      { title: "Anchor moved", body: "NOF Q4 closes 2026-11-13." },
    ]);
    expect(memory?.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(memory?.relativePath).toBe(path.join("memory", "notes.md"));
  });

  it("keeps hand-authored prose that sits above the first heading", () => {
    projectDir = temporaryRoot();
    fs.mkdirSync(path.join(projectDir, "memory"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "memory", "notes.md"),
      "---\nlast_updated: '2026-08-06'\n---\n\nUser-authored durable notes.\n\n## A note\n\nBody text.\n",
      "utf8",
    );

    const memory = getProjectMemory("demo");
    expect(memory?.preamble).toBe("User-authored durable notes.");
    expect(memory?.sections).toEqual([{ title: "A note", body: "Body text." }]);
  });
});

describe("appendProjectMemoryNote", () => {
  it("creates memory/notes.md with a heading section when none exists yet", () => {
    projectDir = temporaryRoot();
    appendProjectMemoryNote("demo", { title: "Confirmed address", entry: "The address is 1002 S Example Blvd." });

    const content = fs.readFileSync(path.join(projectDir, "memory", "notes.md"), "utf8");
    expect(content).toContain("last_updated:");
    expect(content).toContain("## Confirmed address");
    expect(content).toContain("The address is 1002 S Example Blvd.");
  });

  it("appends a new section after existing ones instead of overwriting them", () => {
    projectDir = temporaryRoot();
    fs.mkdirSync(path.join(projectDir, "memory"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "memory", "notes.md"),
      '---\nlast_updated: "2026-07-01"\n---\n\n## Existing note\n\nSomething already recorded.\n',
      "utf8",
    );

    appendProjectMemoryNote("demo", { title: "New note", entry: "Something new." });

    const content = fs.readFileSync(path.join(projectDir, "memory", "notes.md"), "utf8");
    expect(content).toContain("## Existing note");
    expect(content).toContain("Something already recorded.");
    expect(content).toContain("## New note");
    expect(content).toContain("Something new.");
  });
});

describe("appendProjectMemoryNote concurrency", () => {
  it("refuses to write when an explicit stale expectedHash no longer matches the current file", () => {
    projectDir = temporaryRoot();
    appendProjectMemoryNote("demo", { title: "First", entry: "First entry." });
    const staleHash = "not-the-real-hash";

    expect(() =>
      appendProjectMemoryNote("demo", { title: "Second", entry: "Second entry." }, { expectedHash: staleHash }),
    ).toThrow(ContentConflictError);
    const content = fs.readFileSync(path.join(projectDir, "memory", "notes.md"), "utf8");
    expect(content).not.toContain("## Second");
  });

  it("succeeds when expectedHash is omitted (falls back to its own internally-captured hash)", () => {
    projectDir = temporaryRoot();
    appendProjectMemoryNote("demo", { title: "First", entry: "First entry." });
    appendProjectMemoryNote("demo", { title: "Second", entry: "Second entry." });

    const content = fs.readFileSync(path.join(projectDir, "memory", "notes.md"), "utf8");
    expect(content).toContain("## First");
    expect(content).toContain("## Second");
  });
});

describe("writeReviewFinding", () => {
  it("refuses to overwrite an existing review finding with the same date and id", () => {
    projectDir = temporaryRoot();
    const draft = {
      id: "duplicate-id",
      title: "First finding",
      discipline: "architectural" as const,
      status: "open" as const,
      related_markups: [],
      related_code_sections: [],
      finding: "First.",
      recommendation: "",
    };
    writeReviewFinding("demo", draft);

    expect(() => writeReviewFinding("demo", { ...draft, title: "Second finding", finding: "Second." }))
      .toThrow(ContentConflictError);
  });

  it("writes a review file matching reviewFrontmatterSchema's shape", () => {
    projectDir = temporaryRoot();
    const filePath = writeReviewFinding("demo", {
      id: "occupant-load-gap",
      title: "Occupant load discrepancy",
      discipline: "architectural",
      status: "open",
      related_markups: [],
      related_code_sections: [],
      finding: "Code-calculated occupant load exceeds the operational cap letter.",
      recommendation: "Confirm with the fire marshal before permit submission.",
    });

    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("type: review");
    expect(content).toContain("discipline: architectural");
    expect(content).toContain("status: open");
    expect(content).toContain("# Occupant load discrepancy");
    expect(content).toContain("## Finding");
    expect(content).toContain("Confirm with the fire marshal before permit submission.");
    expect(path.basename(filePath)).toMatch(/^\d{4}-\d{2}-\d{2}-occupant-load-gap\.md$/);
  });
});

describe("getMeetingNotes", () => {
  it("refuses to overwrite a same-id meeting created by another partner", () => {
    projectDir = temporaryRoot();
    const meeting = meetingNoteSchema.parse({
      id: "kickoff",
      title: "Kickoff",
      meeting_type: "Kick-off" as const,
      meeting_status: "planned" as const,
      date: "2026-07-01",
      start_time: "14:00",
      end_time: "15:00",
      timezone: "America/Chicago",
      attendees: [],
      objective: "Agree on the first work phase.",
      preparation: ["Review the contract."],
      agenda_items: [
        { topic: "Contract scope", duration_minutes: 20, desired_outcome: "Confirm what is included." },
        { topic: "Work plan", duration_minutes: 40, desired_outcome: "Assign the first tasks." },
      ],
      raw_notes: "",
      summary: "First version",
      decisions: [],
      action_items: [],
      open_questions: [],
    });
    writeMeetingNote("demo", meeting);
    expect(() => writeMeetingNote("demo", { ...meeting, summary: "Second version" }))
      .toThrow(ContentConflictError);
    const [saved] = getMeetingNotes("demo");
    expect(saved.summary).toBe("First version");
    expect(saved.agenda_items).toHaveLength(2);
    const markdown = fs.readFileSync(path.join(projectDir, "meetings", "2026-07-01-kickoff.md"), "utf8");
    expect(markdown).toContain("## Agenda");
    expect(markdown).toContain("**Contract scope** — 20 minutes");
  });

  it("ignores a Dropbox conflicted-copy meeting note instead of trying to parse it", () => {
    projectDir = temporaryRoot();
    const meetingsDir = path.join(projectDir, "meetings");
    fs.mkdirSync(meetingsDir, { recursive: true });
    const frontmatter = [
      "---",
      "id: kickoff",
      "title: Kickoff",
      "meeting_type: Kick-off",
      "date: \"2026-07-01\"",
      "start_time: \"14:00\"",
      "end_time: \"15:00\"",
      "timezone: America/Chicago",
      "attendees: []",
      "raw_notes: \"\"",
      "summary: \"\"",
      "decisions: []",
      "action_items: []",
      "open_questions: []",
      "---",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(meetingsDir, "2026-07-01-kickoff.md"), frontmatter, "utf8");
    // A conflicted-copy sibling that would otherwise throw trying to schema-parse malformed data.
    fs.writeFileSync(
      path.join(meetingsDir, "2026-07-01-kickoff (Partner's conflicted copy 2026-07-02).md"),
      "not valid frontmatter at all",
      "utf8",
    );

    const notes = getMeetingNotes("demo");
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe("kickoff");
    expect(notes[0].meeting_status).toBe("completed");
    expect(notes[0].agenda_items).toEqual([]);
  });

  it("completes a planned agenda in place and keeps a backup of the prior version", () => {
    projectDir = temporaryRoot();
    const planned = meetingNoteSchema.parse({
      id: "client-review",
      title: "Client review",
      meeting_type: "Client Meeting",
      meeting_status: "planned" as const,
      date: "2026-08-12",
      start_time: "10:00",
      end_time: "11:00",
      timezone: "America/Chicago",
      attendees: ["Alex", "Client"],
      objective: "Approve the schematic direction.",
      preparation: ["Review the contract."],
      agenda_items: [{ topic: "Scope", duration_minutes: 60, desired_outcome: "Confirm direction." }],
      raw_notes: "",
      summary: "",
      decisions: [],
      action_items: [],
      open_questions: [],
    });
    writeMeetingNote("demo", planned);
    const [{ hash }] = getMeetingNoteRecords("demo");

    updateMeetingNote("demo", {
      ...planned,
      meeting_status: "completed",
      raw_notes: "Client approved Option B.",
      summary: "Option B was approved.",
      decisions: ["Proceed with Option B."],
    }, hash);

    const records = getMeetingNoteRecords("demo");
    expect(records).toHaveLength(1);
    expect(records[0].meeting.meeting_status).toBe("completed");
    expect(records[0].meeting.summary).toBe("Option B was approved.");
    expect(fs.readdirSync(path.join(projectDir, "meetings", ".mi-backups"))).toHaveLength(1);
  });

  it("refuses a stale planned-meeting update", () => {
    projectDir = temporaryRoot();
    const planned = meetingNoteSchema.parse({
      id: "work-session",
      title: "Work session",
      meeting_type: "Work Session",
      meeting_status: "planned" as const,
      date: "2026-08-13",
      start_time: "13:00",
      end_time: "14:00",
      timezone: "America/Chicago",
      attendees: ["Alex"],
      objective: "Finish the drawing checklist.",
      preparation: [],
      agenda_items: [],
      raw_notes: "",
      summary: "",
      decisions: [],
      action_items: [],
      open_questions: [],
    });
    writeMeetingNote("demo", planned);
    const [{ hash: staleHash }] = getMeetingNoteRecords("demo");
    updateMeetingNote("demo", { ...planned, meeting_status: "completed", summary: "First completion." }, staleHash);

    expect(() => updateMeetingNote(
      "demo",
      { ...planned, meeting_status: "completed", summary: "Stale completion." },
      staleHash,
    )).toThrow(ContentConflictError);
    expect(getMeetingNotes("demo")[0].summary).toBe("First completion.");
  });
});

describe("record deletion", () => {
  function meeting(overrides: Record<string, unknown> = {}) {
    return meetingNoteSchema.parse({
      id: "meeting-1",
      title: "Client review",
      meeting_type: "Client Meeting",
      meeting_status: "planned",
      date: "2026-08-05",
      start_time: "10:00",
      end_time: "11:00",
      timezone: "America/Chicago",
      attendees: [],
      objective: "Review the current set.",
      preparation: [],
      agenda_items: [],
      raw_notes: "",
      summary: "",
      decisions: [],
      action_items: [],
      open_questions: [],
      ...overrides,
    });
  }

  it("deletes a meeting note by id and keeps a recoverable copy", () => {
    projectDir = temporaryRoot();
    writeMeetingNote("demo", meeting());
    writeMeetingNote("demo", meeting({ id: "meeting-2", title: "Site walk" }));
    const records = getMeetingNoteRecords("demo");
    const target = records.find((record) => record.meeting.id === "meeting-1")!;

    const { backupPath } = deleteMeetingNote("demo", "meeting-1", target.hash);

    expect(getMeetingNotes("demo").map((note) => note.id)).toEqual(["meeting-2"]);
    expect(fs.existsSync(backupPath)).toBe(true);
  });

  it("refuses to delete a meeting against a stale hash", () => {
    projectDir = temporaryRoot();
    writeMeetingNote("demo", meeting());
    expect(() => deleteMeetingNote("demo", "meeting-1", "stale-hash"))
      .toThrow(ContentConflictError);
    expect(getMeetingNotes("demo")).toHaveLength(1);
  });

  it("finds a meeting by id even when its filename does not encode its date", () => {
    projectDir = temporaryRoot();
    writeMeetingNote("demo", meeting());
    // Dropbox renames, hand-edits and older exports all produce notes whose filename is not
    // `<date>-<id>.md`. Rebuilding the path from date+id would fail to find those; matching
    // on the parsed id finds them wherever they sit.
    const directory = path.join(projectDir, "meetings");
    const [original] = fs.readdirSync(directory);
    fs.renameSync(path.join(directory, original), path.join(directory, "renamed-by-dropbox.md"));

    const record = getMeetingNoteRecords("demo")[0];
    expect(() => deleteMeetingNote("demo", "meeting-1", record.hash)).not.toThrow();
    expect(getMeetingNotes("demo")).toHaveLength(0);
  });

  it("deletes a hand-authored milestone but refuses one linked to Notion", () => {
    projectDir = temporaryRoot();
    writeProjectSchedule("demo", [
      { id: "m1", name: "Permit set", planned_date: "2026-08-01", actual_date: null, notion_event_id: null },
      { id: "m2", name: "Synced", planned_date: "2026-09-01", actual_date: null, notion_event_id: "notion-abc" },
    ]);
    const hash = readCurrentHash(path.join(projectDir, "schedule", "schedule.yaml"));

    // Dropping a synced row locally would just make the next Notion pull look like a
    // mysterious re-appearance.
    expect(() => deleteProjectMilestone("demo", "m2", hash)).toThrow(/Notion/);

    const removed = deleteProjectMilestone("demo", "m1", hash);
    expect(removed.name).toBe("Permit set");
    expect(getSchedule("demo").milestones.map((m: { id: string }) => m.id)).toEqual(["m2"]);
  });
});
