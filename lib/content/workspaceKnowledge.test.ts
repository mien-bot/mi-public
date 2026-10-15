import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meetingNoteSchema, type MeetingNote } from "@/lib/schema";
import { buildKnowledgeFiles, type KnowledgeInput } from "./workspaceKnowledge";
import type { WorkspaceOutboxEntry } from "./workspaceOutbox";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.resetModules();
});

function meeting(overrides: Partial<MeetingNote> = {}): MeetingNote {
  return meetingNoteSchema.parse({
    id: "owner-meeting",
    title: "Owner meeting",
    meeting_type: "Client Meeting",
    visibility: "client-visible",
    meeting_status: "completed",
    date: "2026-08-12",
    start_time: "10:00",
    end_time: "11:00",
    timezone: "America/Chicago",
    ...overrides,
  });
}

function entry(overrides: Partial<WorkspaceOutboxEntry> = {}): WorkspaceOutboxEntry {
  return {
    version: 1,
    id: "entry-insurance",
    kind: "fact",
    created_at: "2026-08-12T19:00:00.000Z",
    session: { id: "s1", agent: "claude" },
    workspace: { type: "lead", slug: "example" },
    visibility: "internal",
    title: "Example administrative note for STUDIO PLLC",
    body: "STUDIO PLLC uses a reviewed example checklist.",
    why: "The team requested a checklist review.",
    evidence: [{ path: "01_Admin/26_0812_Internal Team Notes.pdf", quote: "" }],
    targets: [],
    needs_confirmation: true,
    meeting: null,
    ...overrides,
  };
}

function input(overrides: Partial<KnowledgeInput> = {}): KnowledgeInput {
  return {
    kind: "lead",
    slug: "example",
    label: "example-record-70",
    meetings: [],
    entries: [],
    generatedAt: "2026-08-13T09:00:00.000Z",
    ...overrides,
  };
}

function markdown(files: Map<string, string>): string {
  return [...files].find(([name]) => name.endsWith("KNOWLEDGE.md"))?.[1] ?? "";
}

describe("buildKnowledgeFiles", () => {
  it("carries each decision's reasoning, not just its outcome", () => {
    const document = markdown(buildKnowledgeFiles(input({
      meetings: [meeting({
        decisions: ["Review checklist approved"],
        decision_records: [{
          statement: "Review checklist approved",
          reasoning: "Casey asked for a checklist before the next review.",
          impacts: ["contract"],
        }],
      })],
    })));

    expect(document).toContain("Review checklist approved");
    expect(document).toContain("Why: Casey asked for a checklist");
    expect(document).toContain("Source: Owner meeting (2026-08-12)");
  });

  it("tags internal material so it cannot be lifted into a client document by accident", () => {
    const document = markdown(buildKnowledgeFiles(input({
      meetings: [meeting({
        visibility: "internal",
        title: "Internal team discussion",
        decisions: ["The checklist needs review"],
      })],
      entries: [entry()],
    })));

    expect(document).toContain("**The checklist needs review** **[INTERNAL — do not send to the client]**");
    expect(document).toContain("STUDIO PLLC");
    expect(document.match(/\[INTERNAL/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("treats a record written before the visibility flag as internal", () => {
    const legacy = meetingNoteSchema.parse({
      id: "legacy", title: "Old note", meeting_type: "Client Meeting", meeting_status: "completed",
      date: "2026-07-01", start_time: "", end_time: "", timezone: "America/Chicago",
      decisions: ["Something agreed"],
    });
    expect(markdown(buildKnowledgeFiles(input({ meetings: [legacy] }))))
      .toContain("**Something agreed** **[INTERNAL");
  });

  it("says a meeting has no attached source rather than implying evidence exists", () => {
    const document = markdown(buildKnowledgeFiles(input({ meetings: [meeting()] })));
    expect(document).toContain("No source attached");
  });

  it("writes nothing at all when no meeting or entry has been captured", () => {
    // These land in the firm's shared Dropbox folders; an all-"None recorded" document in
    // every project teaches people to ignore the one file they should be reading.
    expect(buildKnowledgeFiles(input()).size).toBe(0);
  });

  it("marks itself generated and tells the reader where to record new findings", () => {
    const files = buildKnowledgeFiles(input({ meetings: [meeting({ decisions: ["Something agreed"] })] }));
    const document = markdown(files);
    expect(document.startsWith("<!-- mi-generated:harness-v1 -->")).toBe(true);
    expect(document).toContain("Do not hand-edit");
    expect(document).toContain("`inbox/`");

    const index = [...files].find(([name]) => name.endsWith("knowledge.json"))?.[1] ?? "";
    expect(JSON.parse(index).generatedBy).toBe("Mi");
  });

  it("does not rewrite a view whose only difference is the generation stamp", async () => {
    /*
     * Two Analyze runs over unchanged data must leave the workspace byte-stable. Without
     * this the `Last generated:` line alone rewrites both files every run and drops a
     * .mi-backups copy into the client's shared Dropbox folder each time -- confirmed on
     * the real 1000 W Example workspace before this guard existed.
     */
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-knowledge-"));
    roots.push(root);
    const harnessRoot = path.join(root, "Mi");
    fs.mkdirSync(harnessRoot, { recursive: true });

    vi.doMock("./workspaceOutbox", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./workspaceOutbox")>()),
      resolveWorkspace: () => ({ recordDir: root, workspaceRoot: root, harnessRoot, dropboxPath: null }),
    }));
    const { writeKnowledgeFiles } = await import("./workspaceKnowledge");

    const first = writeKnowledgeFiles("lead", "demo", buildKnowledgeFiles(input({ meetings: [meeting()] })));
    expect(first.every((file) => file.status === "written")).toBe(true);

    const later = writeKnowledgeFiles("lead", "demo", buildKnowledgeFiles(input({
      meetings: [meeting()],
      generatedAt: "2026-09-01T12:00:00.000Z",
    })));
    expect(later.every((file) => file.status === "unchanged")).toBe(true);
    expect(fs.existsSync(path.join(harnessRoot, "knowledge", ".mi-backups"))).toBe(false);
  });

  it("excludes a planned meeting, which records an intention rather than a fact", () => {
    const document = markdown(buildKnowledgeFiles(input({
      meetings: [meeting({ meeting_status: "planned", decisions: ["Not yet agreed"] })],
    })));
    expect(document).not.toContain("Not yet agreed");
  });
});
