import { describe, expect, it } from "vitest";
import { milestoneTier, scheduleEntryTier, slipWarnings, timelineRow, upcomingMarkers } from "./scheduleInsights";
import { milestoneSchema, projectDetailsSchema } from "./schema";

const details = projectDetailsSchema.parse({
  contract_end_date: "2026-12-31",
  phases: [
    { id: "dd", name: "DD", planned_start_date: "2026-06-01", planned_end_date: "2026-08-31" },
    { id: "cd", name: "CD", planned_start_date: "2026-09-15", planned_end_date: "2026-12-01" },
  ],
  payments: [
    { id: "p1", label: "DD retainer", phase_id: "dd", due_date: "2026-08-15" },
    { id: "p2", label: "Paid", phase_id: "dd", due_date: "2026-08-01", paid_date: "2026-08-02" },
    { id: "p3", label: "No date yet" },
  ],
});

describe("schedule tiers", () => {
  it("lets a person's priority override the name", () => {
    expect(milestoneTier({ name: "Permit submission" })).toBe("critical");
    expect(milestoneTier({ name: "Client meeting" })).toBe("low");
    expect(milestoneTier({ name: "Permit submission", priority: "normal" })).toBe("normal");
  });

  it("reads Notion types without inventing a new property", () => {
    expect(scheduleEntryTier(["Deadline"])).toBe("critical");
    expect(scheduleEntryTier(["Midterm Deadline"])).toBe("high");
    expect(scheduleEntryTier(["Meeting"])).toBe("low");
  });
});

describe("timeline row", () => {
  it("keeps undated payments off the calendar instead of guessing a date", () => {
    const milestone = milestoneSchema.parse({ id: "a", name: "Permit", planned_date: "2026-07-01", actual_date: null });
    const row = timelineRow({ slug: "demo", name: "Demo" }, [milestone], details);
    expect(row.markers.map((marker) => marker.id)).toEqual(["a", "payment-p2", "payment-p1", "contract-end"]);
    // The overdue open milestone stays listed; the paid payment does not.
    expect(upcomingMarkers([row], "2026-07-15", 40).map((marker) => marker.id)).toEqual(["a", "payment-p1"]);
  });
});

describe("slip warnings", () => {
  it("warns about phase ends, the next phase, unpaid payments and the contract end", () => {
    const warnings = slipWarnings(details, "2026-07-01", "2026-09-20");
    expect(warnings.join(" ")).toContain("past the end of DD");
    expect(warnings.join(" ")).toContain("overlaps the start of CD");
    expect(warnings.join(" ")).toContain("DD retainer");
    expect(warnings.join(" ")).not.toContain("“Paid”");
    expect(slipWarnings(details, "2026-10-01", "2027-01-05").join(" ")).toContain("contract end date");
  });

  it("stays quiet for moves earlier, or with no project data", () => {
    expect(slipWarnings(details, "2026-09-20", "2026-07-01")).toEqual([]);
    expect(slipWarnings(null, "2026-07-01", "2026-09-20")).toEqual([]);
  });
});
