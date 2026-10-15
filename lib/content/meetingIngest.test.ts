import { describe, expect, it } from "vitest";
import { aiMeetingResponseSchema, meetingNoteSchema, type MeetingNote } from "@/lib/schema";
import { appendRawSourceText, attachSource, describeSource, reconcileExtraction } from "./meetingIngest";
import { pastedSource } from "./documentText";

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

const source = describeSource({
  extracted: pastedSource("Alex: the cap is two times fees."),
  label: "Owner meeting transcript",
  relativePath: null,
  capturedAt: "2026-08-12T18:00:00.000Z",
});

describe("describeSource and attachSource", () => {
  it("hashes the source and keeps one descriptor per distinct file", () => {
    expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.kind).toBe("paste");

    const once = attachSource(meeting(), source);
    const twice = attachSource(once, source);
    expect(twice.sources).toHaveLength(1);
  });
});

describe("reconcileExtraction", () => {
  it("adds decisions with their reasoning and keeps the mirror invariant", () => {
    const extracted = aiMeetingResponseSchema.parse({
      summary: "Nine terms settled.",
      decisions: ["Two rounds of revisions"],
      decision_records: [{
        statement: "Review checklist approved",
        reasoning: "Casey asked for a formula rather than a fixed number.",
        impacts: ["contract"],
      }],
      open_questions: ["Confirm the effective date"],
      blocking_questions: ["Is the retainer $200 or $250?"],
      impacts: [{ area: "fee", summary: "Phase 1 $2,000", detail: "" }],
    });

    const result = reconcileExtraction(meeting(), extracted);
    expect(result.decisions).toContain("Two rounds of revisions");
    expect(result.decisions).toContain("Review checklist approved");
    expect(result.decision_records[0].reasoning).toContain("formula");
    // A blocking question the model returned only in the blocking list still reaches
    // open_questions, or the record would not validate.
    expect(result.open_questions).toContain("Is the retainer $200 or $250?");
    expect(result.blocking_questions).toEqual(["Is the retainer $200 or $250?"]);
    expect(() => meetingNoteSchema.parse(result)).not.toThrow();
  });

  it("never drops what a previous pass recorded", () => {
    // A condensed summary silently lost six agreed contract terms on this lead, so a
    // second extraction may only add.
    const existing = meeting({
      decisions: ["Email termination with unused retainer refunded", "Opt-in photography"],
      open_questions: ["Confirm notice addresses"],
      summary: "First pass.",
    });
    const thin = aiMeetingResponseSchema.parse({ summary: "Shorter.", decisions: ["Opt-in photography"] });

    const result = reconcileExtraction(existing, thin);
    expect(result.decisions).toEqual(expect.arrayContaining([
      "Email termination with unused retainer refunded",
      "Opt-in photography",
    ]));
    expect(result.open_questions).toContain("Confirm notice addresses");
    expect(result.summary).toBe("First pass.");
  });

  it("does not duplicate an action item or impact on a repeat pass", () => {
    const extracted = aiMeetingResponseSchema.parse({
      action_items: [{ description: "Verify RT4 allows three meters", owner: "Alex", due_date: "2026-08-14" }],
      impacts: [{ area: "fee", summary: "Phase 1 $2,000", detail: "" }],
    });
    const once = reconcileExtraction(meeting(), extracted);
    const twice = reconcileExtraction(once, extracted);
    expect(twice.action_items).toHaveLength(1);
    expect(twice.impacts).toHaveLength(1);
  });
});

describe("appendRawSourceText", () => {
  it("keeps the source text in the record and does not append it twice", () => {
    const once = appendRawSourceText(meeting(), source, "Alex: the cap is two times fees.");
    expect(once.raw_notes).toContain("Owner meeting transcript");
    expect(once.raw_notes).toContain("two times fees");

    const twice = appendRawSourceText(once, source, "Alex: the cap is two times fees.");
    expect(twice.raw_notes).toBe(once.raw_notes);
  });
});
