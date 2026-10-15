import { describe, expect, it } from "vitest";
import { aiPlanResponseSchema, projectDetailsSchema, scheduleTypeSchema } from "./schema";

describe("aiPlanResponseSchema", () => {
  it("accepts the full STUDIO Schedule type range, not just deadline types", () => {
    for (const type of scheduleTypeSchema.options) {
      const result = aiPlanResponseSchema.safeParse({
        summary: "Draft summary",
        timeline: [{ name: "Item", date: "2026-08-01", type, rationale: "" }],
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects a type outside the STUDIO Schedule range", () => {
    const result = aiPlanResponseSchema.safeParse({
      summary: "Draft summary",
      timeline: [{ name: "Item", date: "2026-08-01", type: "Not A Real Type", rationale: "" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("projectDetailsSchema phases", () => {
  it("supports separate project phase agreements and schedule dates", () => {
    const result = projectDetailsSchema.parse({
      phases: [{
        id: "ca",
        name: "Construction Administration",
        status: "active",
        charge: 12_500,
        charge_currency: "USD",
        contract_link_or_path: "https://docs.google.com/document/d/confirmed-contract",
        planned_start_date: "2026-08-01",
        planned_end_date: "2026-12-15",
        paid: false,
      }],
    });

    expect(result.phases[0]).toMatchObject({
      name: "Construction Administration",
      status: "active",
      planned_end_date: "2026-12-15",
    });
  });

  it("rejects a phase whose planned end precedes its planned start", () => {
    const result = projectDetailsSchema.safeParse({
      phases: [{
        id: "permit",
        name: "Permit",
        planned_start_date: "2026-09-01",
        planned_end_date: "2026-08-01",
      }],
    });

    expect(result.success).toBe(false);
  });
});
