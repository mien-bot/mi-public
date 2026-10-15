import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildAgentPrompt,
  buildInterviewStepPrompt,
  interviewStepInstructions,
  loadAgentContext,
  summarizeScheduleSnapshot,
} = require("./agentContext.js");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeSnapshot(root: string, snapshot: unknown) {
  const dir = path.join(root, "notion");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "schedule-snapshot.json"), JSON.stringify(snapshot), "utf8");
}

describe("project copilot prompt", () => {
  it("frames project chat as proposal-only and confirmation-gated", () => {
    const prompt = buildAgentPrompt("Record two hours for Alex", {
      trustedMemory: "",
      projectContext: "name: Sample",
      codesContext: "",
      projectSlug: "sample-project",
    });
    expect(prompt).toContain("read-only project copilot");
    expect(prompt).toContain("Never edit files");
    expect(prompt).toContain("```mi-proposals");
    expect(prompt).toContain("explicitly confirm");
    expect(prompt).toContain("decision-record");
    expect(prompt).toContain("site-report");
    expect(prompt).not.toContain("write or append");
  });

  it("does not invite project mutations without project context", () => {
    const prompt = buildAgentPrompt("Hello", {
      trustedMemory: "",
      projectContext: "",
      codesContext: "",
      scheduleContext: "",
      projectSlug: null,
    });
    expect(prompt).not.toContain("mi-proposals");
  });

  it("includes firm-wide schedule context and switches to holistic instructions with no project", () => {
    const prompt = buildAgentPrompt("What's my workload look like?", {
      trustedMemory: "",
      projectContext: "",
      codesContext: "",
      scheduleContext: "Firm-wide STUDIO Schedule window: 2026-08-01 to 2026-11-29 (1 item).",
      projectSlug: null,
    });
    expect(prompt).toContain("<firm_schedule_context>");
    expect(prompt).toContain("firm-wide planning copilot");
    expect(prompt).toContain("MUST include an explicit project reference");
    expect(prompt).toContain("```mi-proposals");
  });

  it("adds schedule-awareness instructions to the project copilot prompt too", () => {
    const prompt = buildAgentPrompt("When am I free this week?", {
      trustedMemory: "",
      projectContext: "name: Sample",
      codesContext: "",
      scheduleContext: "Firm-wide STUDIO Schedule window: 2026-08-01 to 2026-11-29 (1 item).",
      projectSlug: "sample-project",
    });
    expect(prompt).toContain("read-only project copilot");
    expect(prompt).toContain("<firm_schedule_context>");
    expect(prompt).not.toContain("firm-wide planning copilot");
  });
});

describe("summarizeScheduleSnapshot", () => {
  it("returns an empty string when no snapshot file exists yet", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-schedule-ctx-"));
    roots.push(root);
    expect(summarizeScheduleSnapshot(root, {})).toBe("");
  });

  it("summarizes entries and honestly reports missing/matched attendee identity", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-schedule-ctx-"));
    roots.push(root);
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
    expect(withAttendee).toContain("2026-08-05 PTO");
  });
});

describe("compact project record context", () => {
  it("matches the server context boundary by indexing records without loading their bodies", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-electron-record-ctx-"));
    roots.push(root);
    const projectDir = path.join(root, "projects", "sample-project");
    fs.mkdirSync(path.join(projectDir, "decisions"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "site-reports"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "project.yaml"), "name: Sample Project\n", "utf8");
    fs.writeFileSync(
      path.join(projectDir, "decisions", "2026-07-28-decision-entry.md"),
      "---\nid: decision-entry\ntitle: Entry direction\nstatus: proposed\ndecision_date: 2026-07-28\n---\nPRIVATE BODY",
      "utf8",
    );

    const context = loadAgentContext(root, "sample-project");
    expect(context.projectContext).toContain("name: Sample Project");
    expect(context.projectContext).not.toContain("PRIVATE BODY");
    expect(context.projectRecordSummary).toContain("decision-entry [proposed]");
  });
});

describe("interviewStepInstructions", () => {
  it("names the target proposal kind for building-meta and never asks for a milestone status", () => {
    const text = interviewStepInstructions("building-meta", "none yet");
    expect(text).toContain("\"project-meta\"");
    expect(text).toContain("building_type");
    expect(text).toContain("occupancy_group");
    expect(text.toLowerCase()).toContain("never ask for or propose a milestone status");
  });

  it("names the target proposal kind for schedule and instructs batching one proposal per milestone", () => {
    const text = interviewStepInstructions("schedule", "none yet");
    expect(text).toContain("\"schedule-item\"");
    expect(text).toContain("per distinct milestone");
    expect(text.toLowerCase()).toContain("never ask for or propose a milestone status");
  });

  it("names the target proposal kind for client-contacts, address-scope, and team-fee", () => {
    expect(interviewStepInstructions("client-contacts", "none yet")).toContain("\"project-details\"");
    expect(interviewStepInstructions("address-scope", "none yet")).toContain("\"project-details\"");
    expect(interviewStepInstructions("team-fee", "none yet")).toContain("\"project-details\"");
  });

  it("tells the model constraints-deliverables has no dedicated proposal kind and a blank result is fine", () => {
    const text = interviewStepInstructions("constraints-deliverables", "none yet");
    expect(text).toContain("no dedicated proposal kind");
    expect(text).toContain("fine to end this step with no proposal at all");
  });

  it("asks exactly one focused follow-up question instead of guessing, and never emits a premature block", () => {
    const text = interviewStepInstructions("client-contacts", "none yet");
    expect(text).toContain("ask exactly one");
    expect(text).toContain("do not emit a ```mi-proposals block yet");
  });

  it("embeds the caller-supplied already-known summary so the model doesn't re-propose known fields", () => {
    const text = interviewStepInstructions("team-fee", 'team=[{"name":"Example User"}], fee=50000');
    expect(text).toContain('team=[{"name":"Example User"}], fee=50000');
  });

  it("does not leak one step's directive text into another step's instructions", () => {
    const buildingMeta = interviewStepInstructions("building-meta", "none yet");
    const schedule = interviewStepInstructions("schedule", "none yet");
    expect(buildingMeta).not.toContain("schedule-item");
    expect(schedule).not.toContain("project-meta");
    expect(schedule).not.toContain("occupancy_group");
  });
});

describe("buildInterviewStepPrompt", () => {
  it("retains the existing confirm-gate/mi-proposals contract language from buildAgentPrompt and appends the step directive", () => {
    const prompt = buildInterviewStepPrompt(
      {
        prompt: "The building is a small restaurant.",
        stepId: "building-meta",
        alreadyKnownSummary: "none yet",
      },
      {
        trustedMemory: "",
        projectContext: "name: Sample",
        codesContext: "",
        projectSlug: "sample-project",
      },
    );
    // Shared envelope/schema/confirm-gate language, unchanged from buildAgentPrompt.
    expect(prompt).toContain("read-only project copilot");
    expect(prompt).toContain("```mi-proposals");
    expect(prompt).toContain("explicitly confirm");
    // Step-specific directive appended on top.
    expect(prompt).toContain("\"project-meta\"");
    expect(prompt).toContain("building_type");
  });

  it("never asks for a milestone status value even for the schedule step", () => {
    const prompt = buildInterviewStepPrompt(
      { prompt: "Kickoff is next Tuesday.", stepId: "schedule", alreadyKnownSummary: "none yet" },
      { trustedMemory: "", projectContext: "", codesContext: "", projectSlug: "sample-project" },
    );
    // The disclaimer itself is the only place "milestone status" should appear,
    // and it must read as a prohibition, not an instruction to collect one.
    expect(prompt.toLowerCase()).toContain("never ask for or propose a milestone status");
    expect(prompt.toLowerCase()).not.toContain("set the milestone status");
    expect(prompt.toLowerCase()).not.toContain("ask for the milestone status");
  });
});
