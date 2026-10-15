import { describe, expect, it } from "vitest";
import { meetingNoteSchema, type MeetingNote } from "@/lib/schema";
import {
  buildWorkspaceAnalysis,
  compareAnalyses,
  detectBlockers,
  detectContradictions,
  detectStaleness,
  moneyFigures,
  type AnalysisInput,
} from "./workspaceAnalysis";
import type { WorkspaceOutboxEntry } from "./workspaceOutbox";

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
    id: "entry-internal-fee",
    kind: "record-change",
    created_at: "2026-08-12T20:00:00.000Z",
    session: { id: "s1", agent: "claude" },
    workspace: { type: "lead", slug: "example" },
    visibility: "internal",
    title: "Internal team discussion fee ladder",
    body: "Phase 1 $4,500, Phase 2 $2,500, package total $6,000.",
    why: "The team priced the structural complexity higher than the filed contract.",
    evidence: [{ path: "01_Admin/26_0812_Internal Team Notes.pdf", quote: "" }],
    targets: [{ record: "lead.yaml", field: "estimated_value", proposed: "4500", current: "6000" }],
    needs_confirmation: true,
    meeting: null,
    ...overrides,
  };
}

function input(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    subject: {
      kind: "lead",
      slug: "example",
      label: "example-record-70",
      fields: { status: "proposal-sent", estimated_value: "6000", contract_stage: "not-sent" },
      anchorDate: "2026-08-11",
    },
    meetings: [],
    entries: [],
    files: [],
    folder: { status: "scanned", added: [], changed: [], removed: [], lastScannedAt: null },
    today: "2026-08-13",
    ...overrides,
  };
}

describe("moneyFigures", () => {
  it("reads every distinct figure out of prose", () => {
    expect(moneyFigures("Phase 1 $4,500, Phase 2 $2,500, total $6,000.")).toEqual([4500, 2500, 6000]);
    expect(moneyFigures("No numbers here.")).toEqual([]);
  });
});

describe("detectContradictions", () => {
  it("surfaces a record value and a captured value that disagree, citing both", () => {
    const findings = detectContradictions(input({ entries: [entry()] }));
    const conflict = findings.find((finding) => finding.field === "estimated_value");
    expect(conflict).toBeDefined();
    expect(conflict?.detail).toContain("6000");
    expect(conflict?.detail).toContain("4500");
    expect(conflict?.evidence).toContain("01_Admin/26_0812_Internal Team Notes.pdf");
  });

  it("catches a fee set whose parts do not sum to its own stated total", () => {
    // $4,500 + $2,500 is $7,000, not the $6,000 the same source states.
    const findings = detectContradictions(input({ entries: [entry()] }));
    const arithmetic = findings.find((finding) => finding.title.includes("does not match its parts"));
    expect(arithmetic).toBeDefined();
    expect(arithmetic?.detail).toContain("$7,000");
    expect(arithmetic?.detail).toContain("$6,000");
  });

  it("does not invent an equation from an entry that quotes two competing ladders", () => {
    // The entry recording the conflict names both ladders on purpose: $4,500/$2,500/$6,000
    // in the body and the contract's $2,000/$2,500/$4,500 in the reasoning. Summing across
    // both produced a bogus "= $16,000" finding.
    const findings = detectContradictions(input({ entries: [entry()] }));
    const arithmetic = findings.filter((finding) => finding.title.includes("does not match its parts"));
    expect(arithmetic).toHaveLength(1);
    expect(arithmetic[0].detail).not.toContain("$16,000");
  });

  it("stays silent when a fee statement names no total of its own", () => {
    const noTotal = entry({ body: "Phase 1 $4,500 and Phase 2 $2,500." });
    const findings = detectContradictions(input({ entries: [noTotal] }));
    expect(findings.some((finding) => finding.title.includes("does not match its parts"))).toBe(false);
  });

  it("reports one finding when two sources state the same broken arithmetic", () => {
    const findings = detectContradictions(input({
      meetings: [meeting({
        impacts: [{ area: "fee", summary: "Phase 1 $4,500, Phase 2 $2,500, total $6,000", detail: "" }],
      })],
      entries: [entry()],
    }));
    const arithmetic = findings.filter((finding) => finding.title.includes("does not match its parts"));
    expect(arithmetic).toHaveLength(1);
    expect(arithmetic[0].detail).toContain("and");
  });

  it("reports nothing when every source agrees", () => {
    const agreeing = entry({
      targets: [{ record: "lead.yaml", field: "estimated_value", proposed: "6000", current: "6000" }],
      body: "Confirmed at $6,000.",
    });
    expect(detectContradictions(input({ entries: [agreeing] }))).toHaveLength(0);
  });

  it("does not resolve a conflict by preferring the newer source", () => {
    const findings = detectContradictions(input({ entries: [entry()] }));
    const conflict = findings.find((finding) => finding.field === "estimated_value");
    // Both claims survive in the detail; nothing is dropped as superseded.
    expect(conflict?.detail).toContain("versus");
  });
});

describe("detectStaleness", () => {
  it("reports a status that predates the meetings and documents around it", () => {
    const findings = detectStaleness(input({
      meetings: [meeting()],
      files: [{
        relativePath: "01_Admin/26_0812_Contract_Rev3.docx",
        fileName: "26_0812_Contract_Rev3.docx",
        folder: "01_Admin",
        extension: ".docx",
        size: 10,
        namedDate: "2026-08-12",
        dateSource: "file",
        notableFolder: true,
      }],
    }));
    const stale = findings.find((finding) => finding.title.includes("proposal-sent"));
    expect(stale).toBeDefined();
    expect(stale?.detail).toContain("1 meeting(s)");
    expect(stale?.detail).toContain("2026-08-12");
  });

  it("flags a planned meeting whose date has passed", () => {
    const findings = detectStaleness(input({
      meetings: [meeting({ id: "site-visit", title: "Site visit", meeting_status: "planned", date: "2026-08-15" })],
      today: "2026-08-20",
    }));
    expect(findings.some((finding) => finding.title.includes("Site visit"))).toBe(true);
  });

  it("leaves a planned meeting still in the future alone", () => {
    const findings = detectStaleness(input({
      meetings: [meeting({ id: "site-visit", title: "Site visit", meeting_status: "planned", date: "2026-08-15" })],
      today: "2026-08-13",
    }));
    expect(findings.some((finding) => finding.title.includes("Site visit"))).toBe(false);
  });
});

describe("detectBlockers", () => {
  it("collects blocking questions from meetings and risks from terminal sessions", () => {
    const findings = detectBlockers(input({
      meetings: [meeting({
        open_questions: ["Confirm the non-refundable retainer is $200 or $250"],
        blocking_questions: ["Confirm the non-refundable retainer is $200 or $250"],
      })],
      entries: [entry({ id: "entry-footing", kind: "risk", title: "Footing depth may be a deal-breaker" })],
    }));
    expect(findings.map((finding) => finding.title)).toEqual(expect.arrayContaining([
      "Confirm the non-refundable retainer is $200 or $250",
      "Footing depth may be a deal-breaker",
    ]));
  });
});

describe("buildWorkspaceAnalysis", () => {
  it("is idempotent: a second run over unchanged data reports nothing new", () => {
    const source = input({ entries: [entry()], meetings: [meeting()] });
    const first = buildWorkspaceAnalysis(source, "2026-08-13T10:00:00.000Z");
    const second = buildWorkspaceAnalysis(source, "2026-08-13T18:30:00.000Z");

    expect(second.signature).toBe(first.signature);
    const comparison = compareAnalyses(first, second);
    expect(comparison.unchanged).toBe(true);
    expect(comparison.newFindings).toHaveLength(0);
    expect(comparison.resolvedFindings).toHaveLength(0);
  });

  it("reports a finding as resolved once the underlying disagreement is gone", () => {
    const before = buildWorkspaceAnalysis(input({ entries: [entry()] }), "2026-08-13T10:00:00.000Z");
    const after = buildWorkspaceAnalysis(input(), "2026-08-14T10:00:00.000Z");
    const comparison = compareAnalyses(before, after);
    expect(comparison.unchanged).toBe(false);
    expect(comparison.resolvedFindings.length).toBeGreaterThan(0);
  });

  it("says the folder was not read rather than implying it was empty", () => {
    const analysis = buildWorkspaceAnalysis(input({
      folder: { status: "unreachable", reason: "Dropbox is offline", added: [], changed: [], removed: [], lastScannedAt: null },
    }), "2026-08-13T10:00:00.000Z");

    expect(analysis.folderRead).toBe(false);
    expect(analysis.folderNote).toContain("not read");
    expect(analysis.folderNote).toContain("Dropbox is offline");
    expect(analysis.newFiles).toEqual([]);
  });

  it("orders overdue action items first", () => {
    const analysis = buildWorkspaceAnalysis(input({
      meetings: [meeting({
        action_items: [
          { description: "Test the Revit licence", owner: "Tommy", due_date: "2026-09-01" },
          { description: "Verify RT4 allows three meters", owner: "Alex", due_date: "2026-08-10" },
        ],
      })],
    }), "2026-08-13T10:00:00.000Z");

    expect(analysis.actionItems[0]).toMatchObject({ description: "Verify RT4 allows three meters", overdue: true });
    expect(analysis.actionItems[1]).toMatchObject({ description: "Test the Revit licence", overdue: false });
  });

  it("counts a meeting written before the visibility flag as needing confirmation", () => {
    const legacy = meetingNoteSchema.parse({
      id: "legacy", title: "Old note", meeting_type: "Client Meeting", meeting_status: "completed",
      date: "2026-07-01", start_time: "", end_time: "", timezone: "America/Chicago",
    });
    const analysis = buildWorkspaceAnalysis(input({ meetings: [legacy] }), "2026-08-13T10:00:00.000Z");
    expect(analysis.missing.join(" ")).toContain("predate the visibility flag");
  });
});
