import { describe, expect, it } from "vitest";
import {
  calculateOccupants,
  calculateWorkplaceZoneArea,
  compareEpds,
  occupancyStudySchema,
  type EpdRecord,
} from "./architectTools";

const source = {
  title: "Official record",
  url: "https://example.gov/source",
  accessed_on: "2026-07-28",
  authority: "Public agency",
  section: "Table 1",
  notes: "",
};

function epd(overrides: Partial<EpdRecord> = {}): EpdRecord {
  return {
    id: "epd-12345678",
    product_id: "product-12345678",
    declared_unit: "1 m2",
    system_boundary: "A1-A3",
    pcr: "PCR 2025",
    standard: "EN 15804+A2",
    valid_through: "2030-07-28",
    gwp_value: 10,
    gwp_unit: "kg CO2e",
    source,
    notes: "",
    professional_review_required: true,
    ...overrides,
  };
}

describe("architect tool calculations", () => {
  it("rounds occupant calculations up and calculates workplace zone areas", () => {
    expect(calculateOccupants(151, 150)).toBe(2);
    expect(calculateWorkplaceZoneArea(10_000, 32.5)).toBe(3_250);
  });

  it("refuses an occupancy record whose displayed result does not match the math", () => {
    expect(occupancyStudySchema.safeParse({
      id: "occupancy-12345678",
      title: "Level 1",
      jurisdiction: "Chicago, Illinois",
      code_edition: "Verified edition",
      created_at: "2026-07-28T18:00:00.000Z",
      areas: [{
        id: "area-1",
        name: "Office",
        area_sf: 151,
        factor_sf_per_person: 150,
        basis: "gross",
        occupants: 1,
      }],
      total_occupants: 1,
      assumptions: [],
      sources: [source],
      status: "draft",
      reviewed_by: null,
      professional_review_required: true,
    }).success).toBe(false);
  });

  it("blocks EPD comparisons when declared units or boundaries differ", () => {
    const comparison = compareEpds(
      epd(),
      epd({
        id: "epd-87654321",
        product_id: "product-87654321",
        declared_unit: "1 kg",
        system_boundary: "A1-A5",
      }),
    );
    expect(comparison.comparable).toBe(false);
    expect(comparison.blockers).toEqual([
      "Declared units differ.",
      "System boundaries differ.",
    ]);
  });

  it("compares only compatible EPD records", () => {
    const comparison = compareEpds(
      epd(),
      epd({ id: "epd-87654321", product_id: "product-87654321", gwp_value: 8 }),
    );
    expect(comparison).toMatchObject({
      comparable: true,
      lowerGwpEpdId: "epd-87654321",
      difference: 2,
      percentDifference: 20,
    });
  });
});
