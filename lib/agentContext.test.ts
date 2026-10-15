import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentPrompt, loadAgentContext, summarizeScheduleSnapshot } from "./agentContext";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-lib-agent-ctx-"));
  roots.push(root);
  return root;
}

function writeSnapshot(root: string, snapshot: unknown) {
  const dir = path.join(root, "notion");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "schedule-snapshot.json"), JSON.stringify(snapshot), "utf8");
}

describe("summarizeScheduleSnapshot", () => {
  it("returns an empty string when no snapshot file exists yet", () => {
    expect(summarizeScheduleSnapshot(tempRoot(), {})).toBe("");
  });

  it("summarizes entries and honestly reports missing/matched attendee identity", () => {
    const root = tempRoot();
    writeSnapshot(root, {
      schema_version: 1,
      generated_at: "2026-08-01T00:00:00.000Z",
      window: { from: "2026-07-02", to: "2026-11-29" },
      entries: [
        { date: "2026-08-10T09:00:00-05:00", date_end: "2026-08-10T10:00:00-05:00", start_time: "2026-08-10T13:33:00-05:00", end_time: null, name: "Client Meeting", type: ["Client Meeting"], attendees: [{ id: "p1", name: "Example User" }] },
        { date: "2026-08-05", name: "PTO", type: [], attendees: [{ id: "p1", name: "Example User" }] },
      ],
    });

    const noAttendee = summarizeScheduleSnapshot(root, {});
    expect(noAttendee).toContain("2026-07-02 to 2026-11-29");
    expect(noAttendee).toContain("2026-08-05: PTO");
    expect(noAttendee).toContain("2026-08-10T09:00:00-05:00 to 2026-08-10T10:00:00-05:00: Client Meeting");
    expect(noAttendee).toContain("No confirmed attendee name is set");

    const withAttendee = summarizeScheduleSnapshot(root, { notionAttendeeName: "Example User" });
    expect(withAttendee).toContain('Items where "Example User" is listed in Attendance (2)');
  });
});

describe("loadAgentContext with a schedule snapshot", () => {
  it("threads dataRoot/notionAttendeeName through into scheduleContext, defaulting dataRoot to repoRoot", () => {
    const root = tempRoot();
    writeSnapshot(root, {
      schema_version: 1,
      generated_at: "2026-08-01T00:00:00.000Z",
      window: { from: "2026-07-02", to: "2026-11-29" },
      entries: [{ date: "2026-08-05", name: "PTO", type: [], attendees: [] }],
    });

    const context = loadAgentContext(root, undefined, process.env, root, null);
    expect(context.scheduleContext).toContain("PTO");
  });

  it("existing two-argument callers are unaffected (no schedule context, no throw)", () => {
    const root = tempRoot();
    const context = loadAgentContext(root, undefined);
    expect(context.scheduleContext).toBe("");
  });

  it("indexes decision and site-report metadata without loading their full bodies", () => {
    const root = tempRoot();
    const projectDir = path.join(root, "projects", "sample-project");
    fs.mkdirSync(path.join(projectDir, "decisions"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "site-reports"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "project.yaml"), "name: Sample Project\n", "utf8");
    fs.writeFileSync(
      path.join(projectDir, "decisions", "2026-07-28-decision-lobby.md"),
      [
        "---",
        "id: decision-lobby",
        "title: Lobby ceiling direction",
        "status: decided",
        "decision_date: 2026-07-28",
        "---",
        "PRIVATE DECISION BODY SHOULD NOT BE IN THE AUTOMATIC CONTEXT",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(projectDir, "site-reports", "2026-07-28-site-report-01.md"),
      [
        "---",
        "id: site-report-01",
        "title: Existing conditions walk",
        "status: draft",
        "visit_date: 2026-07-28",
        "items:",
        "  - id: O-001",
        "    kind: observation",
        "    text: Existing wall remains.",
        "---",
        "PRIVATE SITE REPORT BODY SHOULD NOT BE IN THE AUTOMATIC CONTEXT",
      ].join("\n"),
      "utf8",
    );

    const context = loadAgentContext(root, "sample-project");
    expect(context.projectContext).toContain("name: Sample Project");
    expect(context.projectContext).not.toContain("PRIVATE DECISION BODY");
    expect(context.projectContext).not.toContain("PRIVATE SITE REPORT BODY");
    expect(context.projectRecordSummary).toContain("decision-lobby [decided]");
    expect(context.projectRecordSummary).toContain("site-report-01 [draft]");
    expect(context.projectRecordSummary).toContain("1 item(s)");
    expect(context.files).not.toContain("projects/sample-project/decisions/2026-07-28-decision-lobby.md");
  });
});

describe("buildAgentPrompt holistic vs project-scoped instructions", () => {
  function context(overrides: Partial<Parameters<typeof buildAgentPrompt>[1]> = {}) {
    return {
      trustedMemory: "",
      projectContext: "",
      codesContext: "",
      scheduleContext: "",
      projectRecordSummary: "",
      files: [],
      bytes: 0,
      ...overrides,
    };
  }

  it("uses holistic planning instructions with schedule context but no project", () => {
    const prompt = buildAgentPrompt(
      { prompt: "What's my workload?" },
      context({ scheduleContext: "Firm-wide STUDIO Schedule window: 2026-08-01 to 2026-11-29 (1 item)." }),
    );
    expect(prompt).toContain("firm-wide planning copilot");
    expect(prompt).toContain("<firm_schedule_context>");
  });

  it("uses project copilot instructions when a project is selected, even with schedule context present", () => {
    const prompt = buildAgentPrompt(
      { prompt: "When am I free?", project: "sample-project" },
      context({ scheduleContext: "Firm-wide STUDIO Schedule window: 2026-08-01 to 2026-11-29 (1 item)." }),
    );
    expect(prompt).toContain("read-only project copilot");
    expect(prompt).not.toContain("firm-wide planning copilot");
  });

  it("stays a bare prompt with no proposal instructions when nothing is in scope", () => {
    const prompt = buildAgentPrompt({ prompt: "Hello" }, context());
    expect(prompt).not.toContain("mi-proposals");
  });
});
