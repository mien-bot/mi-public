import { z } from "zod";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idSchema = (prefix: string) => z.string().regex(
  new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]{7,}$`),
  `Use a stable ${prefix}-… identifier.`,
);

export const architectSourceSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: z.string().url(),
  accessed_on: dateOnlySchema,
  authority: z.string().trim().min(1).max(200),
  section: z.string().trim().max(300).default(""),
  notes: z.string().trim().max(2_000).default(""),
});
export type ArchitectSource = z.infer<typeof architectSourceSchema>;

export const occupancyAreaSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  area_sf: z.number().finite().positive().max(100_000_000),
  factor_sf_per_person: z.number().finite().positive().max(1_000_000),
  basis: z.enum(["gross", "net"]),
  occupants: z.number().int().positive().max(1_000_000),
});
export type OccupancyArea = z.infer<typeof occupancyAreaSchema>;

export const occupancyStudySchema = z.object({
  id: idSchema("occupancy"),
  title: z.string().trim().min(1).max(240),
  jurisdiction: z.literal("Chicago, Illinois"),
  code_edition: z.string().trim().min(1).max(200),
  created_at: z.string().datetime({ offset: true }),
  areas: z.array(occupancyAreaSchema).min(1).max(250),
  total_occupants: z.number().int().positive().max(1_000_000),
  assumptions: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
  sources: z.array(architectSourceSchema).min(1).max(30),
  status: z.enum(["draft", "reviewed"]).default("draft"),
  reviewed_by: z.string().trim().min(1).max(200).nullable().default(null),
  professional_review_required: z.literal(true),
}).superRefine((study, context) => {
  const calculated = study.areas.reduce(
    (sum, area) => sum + Math.ceil(area.area_sf / area.factor_sf_per_person),
    0,
  );
  if (study.total_occupants !== calculated) {
    context.addIssue({
      code: "custom",
      path: ["total_occupants"],
      message: "Total occupants must equal the rounded-up sum of all area calculations.",
    });
  }
  study.areas.forEach((area, index) => {
    if (area.occupants !== Math.ceil(area.area_sf / area.factor_sf_per_person)) {
      context.addIssue({
        code: "custom",
        path: ["areas", index, "occupants"],
        message: "Occupants must be area divided by factor, rounded up.",
      });
    }
  });
  if (study.status === "reviewed" && !study.reviewed_by) {
    context.addIssue({
      code: "custom",
      path: ["reviewed_by"],
      message: "A reviewed study requires the reviewer name.",
    });
  }
});
export type OccupancyStudy = z.infer<typeof occupancyStudySchema>;

export const workplaceZoneSchema = z.object({
  name: z.string().trim().min(1).max(120),
  percentage: z.number().finite().min(0).max(100),
  area_sf: z.number().finite().nonnegative().max(100_000_000),
});
export const workplaceRoomSchema = z.object({
  name: z.string().trim().min(1).max(160),
  count: z.number().int().positive().max(10_000),
  capacity_each: z.number().int().nonnegative().max(100_000),
  area_each_sf: z.number().finite().positive().max(1_000_000),
});
export const workplaceProgramSchema = z.object({
  id: idSchema("workplace"),
  title: z.string().trim().min(1).max(240),
  created_at: z.string().datetime({ offset: true }),
  headcount: z.number().int().positive().max(1_000_000),
  total_area_sf: z.number().finite().positive().max(100_000_000),
  work_policy: z.string().trim().min(1).max(2_000),
  zones: z.array(workplaceZoneSchema).min(1).max(30),
  rooms: z.array(workplaceRoomSchema).max(100).default([]),
  assumptions: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
  tradeoffs: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
  status: z.enum(["draft", "reviewed"]).default("draft"),
  reviewed_by: z.string().trim().min(1).max(200).nullable().default(null),
  professional_review_required: z.literal(true),
}).superRefine((program, context) => {
  const percentage = program.zones.reduce((sum, zone) => sum + zone.percentage, 0);
  if (Math.abs(percentage - 100) > 0.01) {
    context.addIssue({
      code: "custom",
      path: ["zones"],
      message: "Workplace zone percentages must total 100%.",
    });
  }
  program.zones.forEach((zone, index) => {
    const expected = Math.round(program.total_area_sf * zone.percentage) / 100;
    if (Math.abs(zone.area_sf - expected) > 0.01) {
      context.addIssue({
        code: "custom",
        path: ["zones", index, "area_sf"],
        message: "Zone area must match its percentage of the total area.",
      });
    }
  });
  if (program.status === "reviewed" && !program.reviewed_by) {
    context.addIssue({
      code: "custom",
      path: ["reviewed_by"],
      message: "A reviewed workplace program requires the reviewer name.",
    });
  }
});
export type WorkplaceProgram = z.infer<typeof workplaceProgramSchema>;

const specPartSchema = z.array(z.string().trim().min(1).max(4_000)).max(100);
export const outlineSpecificationSchema = z.object({
  id: idSchema("spec"),
  title: z.string().trim().min(1).max(240),
  created_at: z.string().datetime({ offset: true }),
  section_number: z.string().trim().min(1).max(40),
  section_title: z.string().trim().min(1).max(240),
  division: z.string().trim().min(1).max(120),
  part_1_general: specPartSchema,
  part_2_products: specPartSchema,
  part_3_execution: specPartSchema,
  sources: z.array(architectSourceSchema).min(1).max(30),
  status: z.enum(["draft", "reviewed"]).default("draft"),
  reviewed_by: z.string().trim().min(1).max(200).nullable().default(null),
  professional_review_required: z.literal(true),
}).superRefine((specification, context) => {
  if (specification.status === "reviewed" && !specification.reviewed_by) {
    context.addIssue({
      code: "custom",
      path: ["reviewed_by"],
      message: "A reviewed specification requires the reviewer name.",
    });
  }
});
export type OutlineSpecification = z.infer<typeof outlineSpecificationSchema>;

export const productRecordSchema = z.object({
  id: idSchema("product"),
  category: z.string().trim().min(1).max(160),
  manufacturer: z.string().trim().min(1).max(200),
  product_name: z.string().trim().min(1).max(240),
  model: z.string().trim().max(200).default(""),
  source: architectSourceSchema,
  notes: z.string().trim().max(4_000).default(""),
  status: z.enum(["candidate", "selected", "rejected"]).default("candidate"),
  selected_by: z.string().trim().min(1).max(200).nullable().default(null),
}).superRefine((product, context) => {
  if (product.status === "selected" && !product.selected_by) {
    context.addIssue({
      code: "custom",
      path: ["selected_by"],
      message: "A selected product requires the person who selected it.",
    });
  }
});
export type ProductRecord = z.infer<typeof productRecordSchema>;

export const epdRecordSchema = z.object({
  id: idSchema("epd"),
  product_id: idSchema("product"),
  declared_unit: z.string().trim().min(1).max(200),
  system_boundary: z.string().trim().min(1).max(200),
  pcr: z.string().trim().min(1).max(300),
  standard: z.string().trim().min(1).max(200),
  valid_through: dateOnlySchema,
  gwp_value: z.number().finite().nonnegative(),
  gwp_unit: z.string().trim().min(1).max(100),
  source: architectSourceSchema,
  notes: z.string().trim().max(4_000).default(""),
  professional_review_required: z.literal(true),
});
export type EpdRecord = z.infer<typeof epdRecordSchema>;

export const chicagoFindingSchema = z.object({
  category: z.enum([
    "property",
    "zoning",
    "permits",
    "violations",
    "landmarks",
    "flood",
    "environmental",
    "geotechnical",
    "other",
  ]),
  status: z.enum(["not-checked", "no-result-found", "result-found", "needs-review"]),
  summary: z.string().trim().min(1).max(6_000),
  source_ids: z.array(z.number().int().nonnegative()).max(30).default([]),
});
export const chicagoSiteStudySchema = z.object({
  id: idSchema("chicago-site"),
  title: z.string().trim().min(1).max(240),
  created_at: z.string().datetime({ offset: true }),
  jurisdiction: z.literal("Chicago, Illinois"),
  address: z.string().trim().min(1).max(500),
  pin: z.string().trim().max(40).default(""),
  zoning_district: z.string().trim().max(80).default(""),
  findings: z.array(chicagoFindingSchema).min(1).max(100),
  sources: z.array(architectSourceSchema).min(1).max(50),
  gaps: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100),
  status: z.enum(["draft", "reviewed"]).default("draft"),
  reviewed_by: z.string().trim().min(1).max(200).nullable().default(null),
  professional_review_required: z.literal(true),
}).superRefine((study, context) => {
  study.findings.forEach((finding, findingIndex) => {
    finding.source_ids.forEach((sourceIndex) => {
      if (!study.sources[sourceIndex]) {
        context.addIssue({
          code: "custom",
          path: ["findings", findingIndex, "source_ids"],
          message: "Every finding source must point to a source included in this study.",
        });
      }
    });
  });
  if (study.status === "reviewed" && !study.reviewed_by) {
    context.addIssue({
      code: "custom",
      path: ["reviewed_by"],
      message: "A reviewed Chicago site study requires the reviewer name.",
    });
  }
});
export type ChicagoSiteStudy = z.infer<typeof chicagoSiteStudySchema>;

export const timeReconstructionSchema = z.object({
  id: idSchema("time"),
  date: dateOnlySchema,
  person: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2_000),
  hours: z.number().finite().positive().max(24),
  evidence_label: z.string().trim().min(1).max(300),
  evidence_path: z.string().trim().min(1).max(1_000)
    .refine((value) => {
      const normalized = value.replaceAll("\\", "/");
      return !normalized.startsWith("/")
        && !/^[A-Za-z]:\//.test(normalized)
        && normalized.split("/").every((segment) => segment && segment !== "." && segment !== "..");
    }, "Evidence must use a safe project-relative path."),
  entered_by: z.string().trim().min(1).max(200),
  entered_at: z.string().datetime({ offset: true }),
  notes: z.string().trim().max(2_000).default(""),
  status: z.literal("human-confirmed"),
});
export type TimeReconstruction = z.infer<typeof timeReconstructionSchema>;

export const architectToolkitSchema = z.object({
  version: z.literal(1),
  occupancy_studies: z.array(occupancyStudySchema).max(100).default([]),
  workplace_programs: z.array(workplaceProgramSchema).max(100).default([]),
  outline_specifications: z.array(outlineSpecificationSchema).max(500).default([]),
  products: z.array(productRecordSchema).max(2_000).default([]),
  epds: z.array(epdRecordSchema).max(2_000).default([]),
  chicago_site_studies: z.array(chicagoSiteStudySchema).max(100).default([]),
  time_reconstructions: z.array(timeReconstructionSchema).max(5_000).default([]),
}).superRefine((toolkit, context) => {
  const collections = [
    toolkit.occupancy_studies,
    toolkit.workplace_programs,
    toolkit.outline_specifications,
    toolkit.products,
    toolkit.epds,
    toolkit.chicago_site_studies,
    toolkit.time_reconstructions,
  ];
  for (const records of collections) {
    const ids = new Set<string>();
    for (const record of records) {
      if (ids.has(record.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate architect-tool id "${record.id}".`,
        });
      }
      ids.add(record.id);
    }
  }
  const productIds = new Set(toolkit.products.map((product) => product.id));
  toolkit.epds.forEach((epd, index) => {
    if (!productIds.has(epd.product_id)) {
      context.addIssue({
        code: "custom",
        path: ["epds", index, "product_id"],
        message: "Every EPD must reference a product in this project library.",
      });
    }
  });
});
export type ArchitectToolkit = z.infer<typeof architectToolkitSchema>;

export const architectToolOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add-occupancy-study"), value: occupancyStudySchema }),
  z.object({ kind: z.literal("add-workplace-program"), value: workplaceProgramSchema }),
  z.object({ kind: z.literal("add-outline-specification"), value: outlineSpecificationSchema }),
  z.object({ kind: z.literal("add-product"), value: productRecordSchema }),
  z.object({ kind: z.literal("add-epd"), value: epdRecordSchema }),
  z.object({ kind: z.literal("add-chicago-site-study"), value: chicagoSiteStudySchema }),
  z.object({ kind: z.literal("add-time-reconstruction"), value: timeReconstructionSchema }),
]);
export type ArchitectToolOperation = z.infer<typeof architectToolOperationSchema>;

export function calculateOccupants(areaSf: number, factorSfPerPerson: number): number {
  if (!Number.isFinite(areaSf) || !Number.isFinite(factorSfPerPerson)
    || areaSf <= 0 || factorSfPerPerson <= 0) {
    throw new Error("Area and occupant-load factor must be positive numbers.");
  }
  return Math.ceil(areaSf / factorSfPerPerson);
}

export function calculateWorkplaceZoneArea(totalAreaSf: number, percentage: number): number {
  if (!Number.isFinite(totalAreaSf) || totalAreaSf <= 0
    || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("Total area and percentage must be valid positive values.");
  }
  return Math.round(totalAreaSf * percentage) / 100;
}

export interface EpdComparison {
  comparable: boolean;
  blockers: string[];
  lowerGwpEpdId: string | null;
  difference: number | null;
  percentDifference: number | null;
}

export function compareEpds(left: EpdRecord, right: EpdRecord): EpdComparison {
  const blockers: string[] = [];
  if (left.declared_unit.trim().toLowerCase() !== right.declared_unit.trim().toLowerCase()) {
    blockers.push("Declared units differ.");
  }
  if (left.system_boundary.trim().toLowerCase() !== right.system_boundary.trim().toLowerCase()) {
    blockers.push("System boundaries differ.");
  }
  if (left.pcr.trim().toLowerCase() !== right.pcr.trim().toLowerCase()) {
    blockers.push("Product category rules differ.");
  }
  if (left.standard.trim().toLowerCase() !== right.standard.trim().toLowerCase()) {
    blockers.push("EPD standards differ.");
  }
  if (left.gwp_unit.trim().toLowerCase() !== right.gwp_unit.trim().toLowerCase()) {
    blockers.push("GWP units differ.");
  }
  if (blockers.length > 0) {
    return {
      comparable: false,
      blockers,
      lowerGwpEpdId: null,
      difference: null,
      percentDifference: null,
    };
  }
  const difference = Math.abs(left.gwp_value - right.gwp_value);
  const baseline = Math.max(left.gwp_value, right.gwp_value);
  return {
    comparable: true,
    blockers: [],
    lowerGwpEpdId: left.gwp_value === right.gwp_value
      ? null
      : left.gwp_value < right.gwp_value ? left.id : right.id,
    difference,
    percentDifference: baseline === 0 ? 0 : (difference / baseline) * 100,
  };
}
