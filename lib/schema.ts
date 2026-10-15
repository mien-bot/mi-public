import { z } from "zod";
import { patchShape } from "@/lib/zodPatch";

/**
 * YAML auto-parses unquoted `2026-07-10`-style values as JS Date objects.
 * Content authors will not remember to quote dates, so normalize either
 * shape down to a plain `YYYY-MM-DD` string here instead of failing the
 * build on unquoted dates.
 */
const dateStringSchema = z.union([z.string(), z.date()]).transform((value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value,
);
const nullableDateStringSchema = dateStringSchema.nullable().default(null);

export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

/**
 * A clock time alone is ambiguous across Mi's Notion sync and DST boundaries, so
 * schedule times carry a full date and an explicit offset. Named error text
 * matters here: this is the field agents get wrong, and Zod's stock message
 * ("Invalid ISO datetime") does not tell anyone what to write instead.
 */
export const isoDateTimeWithOffsetSchema = z
  .string()
  .datetime({ offset: true, message: 'Use a full ISO datetime with a UTC offset, e.g. "2026-09-02T13:00:00-05:00" — not a bare clock time like "13:00".' })
  .nullable()
  .default(null);
export const optionalDateOnlySchema = z.union([dateOnlySchema, z.literal("")]).default("");

/**
 * Single source of truth for every front-matter / YAML shape read out of
 * projects/ and codes/. Content authors are architects/PMs editing files
 * directly, not engineers — these schemas turn a bad edit into a loud build
 * failure (see scripts/validate-content.ts) instead of a silent bad render.
 */

export const disciplineSchema = z.enum([
  "architectural",
  "structural",
  "mep",
  "mechanical",
  "electrical",
  "plumbing",
  "civil",
]);
export type Discipline = z.infer<typeof disciplineSchema>;

/**
 * Matches Studio's actual Notion "Status" options on the Studio Projects
 * database (not-started/in-progress/complete/abandoned) rather than an
 * invented finer-grained scheme, so this stays sync-compatible.
 */
export const projectStatusSchema = z.enum(["not-started", "in-progress", "complete", "abandoned"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const teamMemberSchema = z.object({
  name: z.string(),
  role: z.string(),
});

/**
 * IBC occupancy classification codes (2021 IBC Ch. 3). Structuring
 * occupancy_group as an exact-code array (rather than a slash-joined
 * freeform string) is what makes scripts/suggest-checklist-items.ts's
 * intersection-match against codeSectionFrontmatterSchema.applies_to_occupancy
 * reliable instead of regex-guessing.
 */
export const occupancyGroupCodeSchema = z.enum([
  "A-1", "A-2", "A-3", "A-4", "A-5",
  "B", "E",
  "F-1", "F-2",
  "H-1", "H-2", "H-3", "H-4", "H-5",
  "I-1", "I-2", "I-3", "I-4",
  "M",
  "R-1", "R-2", "R-3", "R-4",
  "S-1", "S-2",
  "U",
]);
export type OccupancyGroupCode = z.infer<typeof occupancyGroupCodeSchema>;

/**
 * FIRM-SEEDED PLACEHOLDER — inferred from Studio's known project mix
 * (restaurant/hospitality, residential, mixed-use), NOT yet reconciled
 * against Notion's real "Project Type" select options (no live check was
 * possible while this was authored). Before treating this as final: run
 * `npm run notion-probe` / inspect the Studio Projects database's actual
 * Project Type options and reconcile — same "confirm once, don't guess"
 * discipline as projectStatusSchema above.
 */
export const buildingTypeSchema = z.enum([
  "restaurant-hospitality",
  "residential-single-family",
  "residential-multifamily",
  "mixed-use",
  "retail-commercial",
  "office",
  "institutional",
  "industrial",
  "tenant-improvement",
  "other",
]);
export type BuildingType = z.infer<typeof buildingTypeSchema>;

export const projectMetaSchema = z.object({
  name: z.string(),
  address: z.string(),
  /** Freeform display label — fallback for projects with no linked client record yet. */
  client: z.string(),
  status: projectStatusSchema,
  /** null = not yet categorized (same TBD-style default as dropbox_path), not guessed. */
  building_type: buildingTypeSchema.nullable().default(null),
  occupancy_group: z.array(occupancyGroupCodeSchema).default([]),
  start_date: nullableDateStringSchema,
  team: z.array(teamMemberSchema).default([]),
  /**
   * Path to this project's real Dropbox folder, relative to the per-machine
   * DROPBOX_ROOT env var (e.g. "1.00 PROJECTS/11_2828 S Example Ave").
   * Optional — a project with no Dropbox folder yet just omits it. Never
   * assume/guess this mapping; it must be set explicitly by a human who
   * knows which real Dropbox folder is this project.
   */
  dropbox_path: z.string().nullable().default(null),
  /** Explicit human-confirmed terminal identity for an older record of the same project.
   * Other metadata and Notion identities remain independent. Never infer from names. */
  terminal_project_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable().optional(),
  /**
   * Where this project's own Mi knowledge (schedule, details, meetings, memory,
   * progress-log, etc. -- NOT project.yaml itself, which always stays local/
   * per-machine) actually lives. "local" is the per-user data root, same as
   * today. "dropbox" means <DROPBOX_ROOT>/<dropbox_path>/Mi/project/ is the
   * live root, so a second installed Mi linked to the same Dropbox sees the
   * same files. Flips only via the explicit, confirmed migration flow --
   * never inferred from dropbox_path alone, so linking and migrating can't
   * collapse into the same instant.
   */
  content_location: z.enum(["local", "dropbox"]).default("local"),
  /** Set only by a successful confirmed migration; null until then. */
  content_migrated_at: nullableDateStringSchema,
  /**
   * This project's page id in Notion's "Studio Projects" database — the stable
   * cross-system identifier used by Notion sync. Established once via
   * `npm run mi -- notion link <slug>` (fuzzy-matches by name, requires
   * human confirmation). Never guess/auto-assign this; null until linked.
   */
  notion_page_id: z.string().nullable().default(null),
  /**
   * Slug of clients/<slug>.yaml this project belongs to. Set by a human —
   * never auto-matched from the freeform `client` string above (names are
   * ambiguous: "Smith" vs "Smith Family Trust" vs a repeat client under a
   * new entity). Null until linked; `client` remains the display fallback.
   */
  client_id: z.string().nullable().default(null),
});
export type ProjectMeta = z.infer<typeof projectMetaSchema>;

/**
 * Narrow AI-facing write path for the guided interview's "building & occupancy"
 * step -- the only project.yaml fields a chat proposal may ever set. `.strict()`
 * is deliberate: project.yaml also carries human-confirmed-only fields
 * (notion_page_id, dropbox_path, client_id) and the computed/synced `status`
 * field, none of which a model reply may smuggle through this path. A crafted
 * proposal containing any other key must fail validation, not silently drop it.
 */
export const projectMetaPatchSchema = z
  .object(patchShape(projectMetaSchema.pick({ building_type: true, occupancy_group: true }).shape))
  .strict();
export type ProjectMetaPatch = z.infer<typeof projectMetaPatchSchema>;

export const progressLogFrontmatterSchema = z.object({
  date: dateStringSchema,
  author: z.string(),
  type: z.literal("progress-log"),
  tags: z.array(z.string()).default([]),
});
export type ProgressLogFrontmatter = z.infer<typeof progressLogFrontmatterSchema>;

export const reviewStatusSchema = z.enum(["open", "in-progress", "resolved"]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const reviewFrontmatterSchema = z.object({
  date: dateStringSchema,
  type: z.literal("review"),
  discipline: disciplineSchema,
  status: reviewStatusSchema,
  related_markups: z.array(z.string()).default([]),
  related_code_sections: z.array(z.string()).default([]),
});
export type ReviewFrontmatter = z.infer<typeof reviewFrontmatterSchema>;

export const markupStatusSchema = z.enum(["open", "addressed", "superseded"]);

export const markupEntrySchema = z.object({
  sheet: z.string(),
  revision: z.number(),
  date: dateStringSchema,
  discipline: disciplineSchema,
  file: z.string(),
  original_file: z.string().optional(),
  status: markupStatusSchema,
  notes: z.string().optional(),
  related_code_sections: z.array(z.string()).default([]),
});
export type MarkupEntry = z.infer<typeof markupEntrySchema>;

export const markupIndexSchema = z.array(markupEntrySchema);

export const codeSectionFrontmatterSchema = z.object({
  id: z.string(),
  code_book: z.string(),
  edition: z.string(),
  chapter: z.string().optional(),
  section: z.string(),
  title: z.string(),
  citation: z.string(),
  official_source_url: z.string().url(),
  applicability_tags: z.array(z.string()).default([]),
  related_sections: z.array(z.string()).default([]),
  /**
   * IBC occupancy group codes this section applies to, or "all" if it's
   * occupancy-agnostic (e.g. general egress). Drives
   * scripts/suggest-checklist-items.ts — a suggestion aid, not a compliance
   * determination; a human still reviews every suggestion.
   */
  applies_to_occupancy: z.array(z.union([occupancyGroupCodeSchema, z.literal("all")])).default(["all"]),
});
export type CodeSectionFrontmatter = z.infer<typeof codeSectionFrontmatterSchema>;

export const checklistItemStatusSchema = z.enum([
  "pending",
  "in-progress",
  "complete",
  "n/a",
  "flagged",
]);

export const checklistItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  code_refs: z.array(z.string()).default([]),
  discipline: disciplineSchema,
  status: checklistItemStatusSchema,
  checked_by: z.string().nullable().default(null),
  checked_date: nullableDateStringSchema,
  evidence: z.array(z.string()).default([]),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistSchema = z.object({
  checklist_id: z.string(),
  items: z.array(checklistItemSchema),
});
export type Checklist = z.infer<typeof checklistSchema>;

export const permitStatusValueSchema = z.enum([
  "not-started",
  "submitted",
  "under-review",
  "approved",
  "rejected",
]);

export const permitEntrySchema = z.object({
  permit_type: z.string(),
  status: permitStatusValueSchema,
  submitted_date: nullableDateStringSchema,
  approved_date: nullableDateStringSchema,
  permit_number: z.string().nullable().default(null),
  notes: z.string().optional(),
});
export type PermitEntry = z.infer<typeof permitEntrySchema>;

export const permitStatusSchema = z.array(permitEntrySchema);

/**
 * Computed, not authored — see lib/content/status.ts. Milestone status is
 * derived from planned_date/actual_date vs. today so editors never have to
 * remember to keep a manual status field in sync.
 */
export const milestoneStatusSchema = z.enum([
  "upcoming",
  "on-track",
  "at-risk",
  "overdue",
  "complete",
]);

export const milestoneSchema = z.object({
  id: z.string(),
  /** Mi-only archive; retained across Notion pulls and reversible from the overview. */
  archived_at: z.string().datetime().optional(),
  name: z.string(),
  planned_date: dateStringSchema,
  actual_date: nullableDateStringSchema,
  /**
   * Id of the corresponding entry in Notion's STUDIO Schedule database, set by
   * the Notion pull when it creates/matches a milestone. Prevents duplicate
   * or mismatched syncing on repeated pulls. Null for hand-authored
   * milestones that have never come from a sync.
   */
  notion_event_id: z.string().nullable().default(null),
  /** Stable client-generated key used to make confirmed Notion retries idempotent. */
  sync_key: z.string().nullable().optional(),
});
export type Milestone = z.infer<typeof milestoneSchema>;

export const scheduleSchema = z.object({
  milestones: z.array(milestoneSchema),
});
export type Schedule = z.infer<typeof scheduleSchema>;

/** Confirmed STUDIO Schedule Type options used by Mi's project copilot. */
export const scheduleTypeSchema = z.enum([
  "Deadline",
  "Midterm Deadline",
  "Kick-off",
  "Meeting",
  "Client Meeting",
  "Internal Meeting",
  "Work Session",
]);
export type ScheduleType = z.infer<typeof scheduleTypeSchema>;

export const scheduleDraftItemSchema = z.object({
  client_request_id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  date: dateOnlySchema,
  type: scheduleTypeSchema,
  /*
   * Full ISO 8601 with an explicit UTC offset, e.g. "2026-09-02T13:00:00-05:00".
   * A bare "13:00" is the natural guess and is rejected -- the message says the
   * expected shape outright, because a whole 18-proposal submission once failed
   * on this and the error only said "Invalid ISO datetime".
   */
  start_time: isoDateTimeWithOffsetSchema,
  end_time: isoDateTimeWithOffsetSchema,
});
export type ScheduleDraftItem = z.infer<typeof scheduleDraftItemSchema>;

export const workLogEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  date: dateOnlySchema,
  hours: z.number().finite().positive().max(24),
  attendees: z.array(z.string().trim().min(1)).min(1),
  notes: z.string().trim().max(2_000).default(""),
  notion_event_id: z.string().nullable().default(null),
  notion_url: z.string().url().nullable().default(null),
  sync_key: z.string().min(1),
});
export type WorkLogEntry = z.infer<typeof workLogEntrySchema>;

export const workLogSchema = z.object({
  entries: z.array(workLogEntrySchema).default([]),
});
export type WorkLog = z.infer<typeof workLogSchema>;

export const projectPlanningInputSchema = z.object({
  goals: z.string().default(""),
  requirements: z.string().default(""),
  scope: z.string().default(""),
  constraints: z.string().default(""),
  target_dates: z.string().default(""),
  permitting: z.string().default(""),
  deliverables: z.string().default(""),
  team_assumptions: z.string().default(""),
  notes: z.string().default(""),
});
export type ProjectPlanningInput = z.infer<typeof projectPlanningInputSchema>;

export const aiPlanResponseSchema = z.object({
  summary: z.string().default(""),
  timeline: z.array(z.object({
    name: z.string().trim().min(1),
    date: dateOnlySchema,
    /** Full STUDIO Schedule type range, matching what a human can add manually. */
    type: scheduleTypeSchema,
    rationale: z.string().default(""),
  })).default([]),
});
export type AiPlanResponse = z.infer<typeof aiPlanResponseSchema>;

/**
 * A project can bill in more than one stage (e.g. Design Development, then
 * Construction Admin) without being split into a second project. Additive to
 * the single fee/fee_currency/fee_notes fields below — those stay the
 * simple/common-case fields; phases is empty by default and only matters for
 * projects that actually have more than one charge.
 */
export const projectPhaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  status: z.enum(["planned", "active", "complete", "on-hold"]).default("planned"),
  charge: z.number().finite().nonnegative().nullable().default(null),
  charge_currency: z.string().trim().length(3).default("USD"),
  contract_link_or_path: z.string().trim().default(""),
  planned_start_date: optionalDateOnlySchema,
  planned_end_date: optionalDateOnlySchema,
  paid: z.boolean().default(false),
}).superRefine((phase, context) => {
  if (
    phase.planned_start_date &&
    phase.planned_end_date &&
    phase.planned_end_date < phase.planned_start_date
  ) {
    context.addIssue({
      code: "custom",
      path: ["planned_end_date"],
      message: "Phase end date must be on or after its start date.",
    });
  }
});
export type ProjectPhase = z.infer<typeof projectPhaseSchema>;

export const projectContactSchema = z.object({
  name: z.string().trim().default(""),
  role: z.string().trim().default(""),
  email: z.union([z.string().email(), z.literal("")]).default(""),
  phone: z.string().trim().default(""),
});

export const projectDetailsSchema = z.object({
  client_name: z.string().trim().default(""),
  client_contacts: z.array(projectContactSchema).default([]),
  address: z.string().trim().default(""),
  scope: z.string().trim().default(""),
  project_type: z.string().trim().default(""),
  team: z.array(teamMemberSchema).default([]),
  fee: z.number().finite().nonnegative().nullable().default(null),
  fee_currency: z.string().trim().length(3).default("USD"),
  fee_notes: z.string().trim().default(""),
  contract_link_or_path: z.string().trim().default(""),
  phases: z.array(projectPhaseSchema).default([]),
});
export type ProjectDetails = z.infer<typeof projectDetailsSchema>;

export const meetingActionItemSchema = z.object({
  description: z.string().trim().min(1),
  owner: z.string().trim().default(""),
  due_date: optionalDateOnlySchema,
});

export const meetingTimeSchema = z.string().regex(
  /^(?:(?:[01]\d|2[0-3]):[0-5]\d)?$/,
  "Use 24-hour HH:MM or leave blank if unconfirmed.",
);

export const meetingAgendaItemSchema = z.object({
  topic: z.string().trim().min(1).max(300),
  duration_minutes: z.number().int().min(1).max(480),
  desired_outcome: z.string().trim().max(1_000).default(""),
});
export type MeetingAgendaItem = z.infer<typeof meetingAgendaItemSchema>;

/**
 * Whether a meeting record may leave the firm.
 *
 * Deliberately has no default anywhere in this file. A record that never states its
 * visibility is treated as `internal` by `meetingVisibility()` below -- failing closed --
 * because the damage here is asymmetric: a client meeting wrongly marked internal is an
 * inconvenience, while an internal record wrongly marked client-visible leaks the team's
 * own doubts about a client's budget, pricing, and competence. If this ever gains a
 * `.default()`, that asymmetry is lost and omission silently becomes disclosure.
 */
export const meetingVisibilitySchema = z.enum(["internal", "client-visible"]);
export type MeetingVisibility = z.infer<typeof meetingVisibilitySchema>;

/** Suggested, not enforced -- meeting_type stays free text so real usage can outgrow this list. */
export const MEETING_TYPE_SUGGESTIONS = [
  "Client Meeting",
  "Internal Team Meeting",
  "Site Visit",
  "Consultant/Contractor Call",
  "Owner Call",
] as const;

/** The four things a meeting can change about a record that a person must review. */
export const meetingImpactAreaSchema = z.enum(["fee", "scope", "schedule", "contract"]);
export type MeetingImpactArea = z.infer<typeof meetingImpactAreaSchema>;

export const meetingImpactSchema = z.object({
  area: meetingImpactAreaSchema,
  summary: z.string().trim().min(1).max(500),
  detail: z.string().trim().max(4_000).default(""),
});
export type MeetingImpact = z.infer<typeof meetingImpactSchema>;

/**
 * A decision plus why it was made. `statement` mirrors one entry of `decisions` so every
 * existing surface that renders the plain string list keeps working unchanged; the
 * superRefine below makes divergence a validation error rather than silent drift.
 */
export const meetingDecisionRecordSchema = z.object({
  statement: z.string().trim().min(1).max(1_000),
  reasoning: z.string().trim().max(4_000).default(""),
  impacts: z.array(meetingImpactAreaSchema).max(4).default([]),
});
export type MeetingDecisionRecord = z.infer<typeof meetingDecisionRecordSchema>;

export const meetingSourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(80),
  kind: z.enum(["paste", "file"]),
  label: z.string().trim().min(1).max(300),
  /** Set for `file` sources: the path relative to the record's confirmed folder. Never absolute. */
  relative_path: z.string().trim().max(1_000).nullable().default(null),
  captured_at: z.string().datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  characters: z.number().int().nonnegative(),
});
export type MeetingSource = z.infer<typeof meetingSourceSchema>;

export const meetingNoteSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().trim().min(1).max(200),
  meeting_type: z.string().trim().min(1).max(100),
  visibility: meetingVisibilitySchema.optional(),
  meeting_status: z.enum(["planned", "completed"]).default("completed"),
  date: dateOnlySchema,
  start_time: meetingTimeSchema,
  end_time: meetingTimeSchema,
  timezone: z.string().min(1),
  attendees: z.array(z.string().trim().min(1)).default([]),
  objective: z.string().trim().max(4_000).default(""),
  preparation: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  agenda_items: z.array(meetingAgendaItemSchema).max(50)
    .refine(
      (items) => items.reduce((total, item) => total + item.duration_minutes, 0) <= 24 * 60,
      "A meeting agenda cannot exceed 24 hours.",
    )
    .default([]),
  raw_notes: z.string().default(""),
  summary: z.string().default(""),
  decisions: z.array(z.string().trim().min(1)).default([]),
  action_items: z.array(meetingActionItemSchema).default([]),
  open_questions: z.array(z.string().trim().min(1)).default([]),
  /** Reasoning for entries of `decisions`. Sparse: a decision may be recorded without one. */
  decision_records: z.array(meetingDecisionRecordSchema).max(100).default([]),
  /** The subset of `open_questions` that blocks progress until answered. */
  blocking_questions: z.array(z.string().trim().min(1)).max(100).default([]),
  impacts: z.array(meetingImpactSchema).max(100).default([]),
  /**
   * Raw material this record was extracted from, retained as evidence. Extraction is a
   * convenience and summaries lose things, so a source is never replaced by what was
   * read out of it.
   */
  sources: z.array(meetingSourceSchema).max(50).default([]),
}).superRefine((meeting, context) => {
  const decisions = new Set(meeting.decisions);
  for (const [index, record] of meeting.decision_records.entries()) {
    if (!decisions.has(record.statement)) {
      context.addIssue({
        code: "custom",
        path: ["decision_records", index, "statement"],
        message: "Every decision record must mirror one entry of decisions.",
      });
    }
  }
  const questions = new Set(meeting.open_questions);
  for (const [index, question] of meeting.blocking_questions.entries()) {
    if (!questions.has(question)) {
      context.addIssue({
        code: "custom",
        path: ["blocking_questions", index],
        message: "Every blocking question must also appear in open_questions.",
      });
    }
  }
});
export type MeetingNote = z.infer<typeof meetingNoteSchema>;

/**
 * Fails closed for records written before `visibility` existed, and for any future path
 * that forgets to set it. Never inline `meeting.visibility ?? "client-visible"`.
 */
export function meetingVisibility(meeting: { visibility?: MeetingVisibility }): MeetingVisibility {
  return meeting.visibility ?? "internal";
}

export function isClientVisibleMeeting(meeting: { visibility?: MeetingVisibility }): boolean {
  return meetingVisibility(meeting) === "client-visible";
}

export const aiMeetingResponseSchema = z.object({
  summary: z.string().default(""),
  decisions: z.array(z.string()).default([]),
  action_items: z.array(meetingActionItemSchema).default([]),
  open_questions: z.array(z.string()).default([]),
  /**
   * Extraction-only enrichments. All optional: a model that returns the older four-field
   * shape still parses, and a drafting path that cannot determine reasoning returns none
   * rather than inventing it.
   */
  decision_records: z.array(meetingDecisionRecordSchema).max(100).default([]),
  blocking_questions: z.array(z.string()).max(100).default([]),
  impacts: z.array(meetingImpactSchema).max(100).default([]),
});
export type AiMeetingResponse = z.infer<typeof aiMeetingResponseSchema>;

const projectRelativeRecordPathSchema = z.string().trim().min(1).max(1_000)
  .transform((value) => value.replaceAll("\\", "/"))
  .refine((value) => {
    if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) return false;
    const segments = value.split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  }, "Use a project-relative path without empty, dot, or parent segments.");

export const projectRecordReferenceKindSchema = z.enum([
  "meeting",
  "decision",
  "site-report",
  "project-file",
  "dropbox-file",
  "notion",
  "conversation",
  "other",
]);
export type ProjectRecordReferenceKind = z.infer<typeof projectRecordReferenceKindSchema>;

export const projectRecordReferenceSchema = z.object({
  kind: projectRecordReferenceKindSchema,
  label: z.string().trim().min(1).max(300),
  path: projectRelativeRecordPathSchema.nullable().default(null),
  url: z.string().url().nullable().default(null),
  item_id: z.string().trim().min(1).max(120).nullable().default(null),
  source_date: dateOnlySchema.nullable().default(null),
  notes: z.string().trim().max(2_000).default(""),
}).superRefine((reference, context) => {
  const pathKinds = new Set([
    "meeting",
    "decision",
    "site-report",
    "project-file",
    "dropbox-file",
  ]);
  if (pathKinds.has(reference.kind) && !reference.path) {
    context.addIssue({
      code: "custom",
      path: ["path"],
      message: `${reference.kind} references require a project-relative path.`,
    });
  }
  if (reference.kind === "conversation" && reference.path) {
    context.addIssue({
      code: "custom",
      path: ["path"],
      message: "Conversation references are not archived file paths.",
    });
  }
  if (reference.kind !== "notion" && reference.url) {
    context.addIssue({
      code: "custom",
      path: ["url"],
      message: "Only Notion references may include an external URL.",
    });
  }
});
export type ProjectRecordReference = z.infer<typeof projectRecordReferenceSchema>;

export const projectDecisionStatusSchema = z.enum(["proposed", "decided", "superseded"]);
export type ProjectDecisionStatus = z.infer<typeof projectDecisionStatusSchema>;

export const projectDecisionIdSchema = z.string()
  .regex(/^decision-[a-z0-9][a-z0-9-]{7,}$/, "Use a stable decision-… identifier.");

export const projectDecisionSchema = z.object({
  version: z.literal(1),
  id: projectDecisionIdSchema,
  title: z.string().trim().min(1).max(240),
  status: projectDecisionStatusSchema,
  decision_date: dateOnlySchema,
  recorded_at: z.string().datetime({ offset: true }),
  confirmed_by: z.string().trim().min(1).max(200).nullable().default(null),
  deciders: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  context: z.string().trim().max(10_000).default(""),
  options: z.array(z.object({
    label: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(4_000).default(""),
  })).max(20).default([]),
  outcome: z.string().trim().max(10_000).default(""),
  rationale: z.string().trim().max(10_000).default(""),
  consequences: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
  affected_deliverables: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  sources: z.array(projectRecordReferenceSchema).min(1).max(50),
  supersedes: projectDecisionIdSchema.nullable().default(null),
  superseded_by: projectDecisionIdSchema.nullable().default(null),
}).superRefine((decision, context) => {
  if (decision.status === "decided" && !decision.outcome) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: "A decided record requires the confirmed outcome.",
    });
  }
  if (decision.status === "decided" && !decision.confirmed_by) {
    context.addIssue({
      code: "custom",
      path: ["confirmed_by"],
      message: "A decided record requires the person who confirmed it.",
    });
  }
  if (decision.status === "superseded" && !decision.superseded_by) {
    context.addIssue({
      code: "custom",
      path: ["superseded_by"],
      message: "A superseded record must identify its replacement.",
    });
  }
  if (decision.status !== "superseded" && decision.superseded_by) {
    context.addIssue({
      code: "custom",
      path: ["superseded_by"],
      message: "Only a superseded record may identify a replacement.",
    });
  }
  if (decision.supersedes === decision.id || decision.superseded_by === decision.id) {
    context.addIssue({
      code: "custom",
      path: ["supersedes"],
      message: "A decision cannot supersede itself.",
    });
  }
});
export type ProjectDecision = z.infer<typeof projectDecisionSchema>;

export const siteReportStatusSchema = z.enum(["draft", "reviewed"]);
export type SiteReportStatus = z.infer<typeof siteReportStatusSchema>;

export const siteReportItemKindSchema = z.enum([
  "direct-observation",
  "reported-information",
  "interpretation",
  "issue",
  "follow-up",
  "limitation",
]);
export type SiteReportItemKind = z.infer<typeof siteReportItemKindSchema>;

export const siteReportItemSchema = z.object({
  id: z.string().regex(/^(O|R|I|ISS|F|L)[1-9]\d*$/, "Use O1, R1, I1, ISS1, F1, or L1."),
  kind: siteReportItemKindSchema,
  location: z.string().trim().max(500).default(""),
  text: z.string().trim().min(1).max(10_000),
  attributed_to: z.string().trim().min(1).max(200).nullable().default(null),
  source_refs: z.array(projectRecordReferenceSchema).max(30).default([]),
  photo_refs: z.array(projectRecordReferenceSchema).max(50).default([]),
  owner: z.string().trim().min(1).max(200).nullable().default(null),
  due_date: dateOnlySchema.nullable().default(null),
}).superRefine((item, context) => {
  const expectedPrefix: Record<SiteReportItemKind, string> = {
    "direct-observation": "O",
    "reported-information": "R",
    interpretation: "I",
    issue: "ISS",
    "follow-up": "F",
    limitation: "L",
  };
  const actualPrefix = item.id.match(/^(ISS|[ORIFL])/)?.[1];
  if (actualPrefix !== expectedPrefix[item.kind]) {
    context.addIssue({
      code: "custom",
      path: ["id"],
      message: `${item.kind} items must use the ${expectedPrefix[item.kind]} number prefix.`,
    });
  }
  if (item.kind === "reported-information" && !item.attributed_to) {
    context.addIssue({
      code: "custom",
      path: ["attributed_to"],
      message: "Reported information requires an attribution, even when the source is recorded as unknown.",
    });
  }
  if (item.kind === "interpretation" && item.source_refs.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["source_refs"],
      message: "An interpretation must identify the evidence it interprets.",
    });
  }
  for (const [index, reference] of item.photo_refs.entries()) {
    if (reference.kind !== "dropbox-file" && reference.kind !== "project-file") {
      context.addIssue({
        code: "custom",
        path: ["photo_refs", index, "kind"],
        message: "Photo references must point to a project or confirmed Dropbox file.",
      });
    }
  }
  if (item.kind !== "follow-up" && (item.owner || item.due_date)) {
    context.addIssue({
      code: "custom",
      path: ["owner"],
      message: "Owner and due date belong only to proposed follow-ups.",
    });
  }
});
export type SiteReportItem = z.infer<typeof siteReportItemSchema>;

export const projectSiteReportIdSchema = z.string()
  .regex(/^site-report-[a-z0-9][a-z0-9-]{7,}$/, "Use a stable site-report-… identifier.");

export const projectSiteReportSchema = z.object({
  version: z.literal(1),
  id: projectSiteReportIdSchema,
  title: z.string().trim().min(1).max(240),
  status: siteReportStatusSchema,
  origin: z.enum(["manual", "ai-assisted"]).default("manual"),
  visit_date: dateOnlySchema,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }).nullable().default(null),
  confirmed_by: z.string().trim().min(1).max(200).nullable().default(null),
  purpose: z.string().trim().max(4_000).default(""),
  scope: z.string().trim().max(10_000).default(""),
  participants: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    role: z.string().trim().max(200).default(""),
  })).max(100).default([]),
  conditions: z.object({
    weather: z.string().trim().max(500).default(""),
    access: z.string().trim().max(2_000).default(""),
    lighting: z.string().trim().max(500).default(""),
    occupancy: z.string().trim().max(500).default(""),
    active_work: z.string().trim().max(1_000).default(""),
  }).default({
    weather: "",
    access: "",
    lighting: "",
    occupancy: "",
    active_work: "",
  }),
  sources: z.array(projectRecordReferenceSchema).max(50).default([]),
  items: z.array(siteReportItemSchema).max(250).default([]),
  raw_notes: z.string().max(100_000).default(""),
  professional_review_required: z.boolean().default(true),
}).superRefine((report, context) => {
  const ids = new Set<string>();
  report.items.forEach((item, index) => {
    if (ids.has(item.id)) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "id"],
        message: `Site-report item id "${item.id}" must be unique.`,
      });
    }
    ids.add(item.id);
  });
  if (report.status === "reviewed" && !report.confirmed_by) {
    context.addIssue({
      code: "custom",
      path: ["confirmed_by"],
      message: "A reviewed site report requires the human reviewer's name.",
    });
  }
  if (report.origin === "ai-assisted" && !report.professional_review_required) {
    context.addIssue({
      code: "custom",
      path: ["professional_review_required"],
      message: "AI-assisted site reports must retain the professional-review requirement.",
    });
  }
});
export type ProjectSiteReport = z.infer<typeof projectSiteReportSchema>;

export const budgetCategorySchema = z.object({
  name: z.string(),
  budgeted: z.number(),
  committed: z.number(),
  actual: z.number(),
  currency: z.string().default("USD"),
});
export type BudgetCategory = z.infer<typeof budgetCategorySchema>;

export const budgetSchema = z.object({
  categories: z.array(budgetCategorySchema),
});
export type Budget = z.infer<typeof budgetSchema>;

export const mepFaqFrontmatterSchema = z.object({
  discipline: disciplineSchema,
  last_updated: dateStringSchema.optional(),
});

/**
 * One entry per file in library/<collection>/index.yaml. Unlike codes/ (which
 * requires a hand-written firm summary per section), this is the "just drop
 * a PDF" pattern — scripts/index-library.ts scans the folder and fills in
 * file/added_date automatically; title/tags/notes are optional hand-edits
 * layered on top later.
 */
export const libraryDocumentSchema = z.object({
  file: z.string().min(1),
  title: z.string().max(500),
  tags: z.array(z.string()).default([]),
  added_date: dateStringSchema,
  source: z.string().optional(),
  notes: z.string().optional(),
});
export type LibraryDocument = z.infer<typeof libraryDocumentSchema>;

export const libraryIndexSchema = z.array(libraryDocumentSchema);

export const libraryDocumentMetadataSchema = libraryDocumentSchema.pick({
  title: true,
  tags: true,
  source: true,
  notes: true,
});
export type LibraryDocumentMetadata = z.infer<typeof libraryDocumentMetadataSchema>;

export const libraryCollectionMetaSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type LibraryCollectionMeta = z.infer<typeof libraryCollectionMetaSchema>;

export const drawingPhaseSchema = z.enum(["sd", "dd", "cd", "ca"]);
export type DrawingPhase = z.infer<typeof drawingPhaseSchema>;

export const drawingStatusSchema = z.enum(["in-progress", "issued", "superseded"]);

export const drawingSetEntrySchema = z.object({
  sheet: z.string(),
  revision: z.number(),
  phase: drawingPhaseSchema,
  date: dateStringSchema,
  file: z.string(),
  status: drawingStatusSchema,
  notes: z.string().optional(),
});
export type DrawingSetEntry = z.infer<typeof drawingSetEntrySchema>;

export const drawingIndexSchema = z.array(drawingSetEntrySchema);

/**
 * deliverables/index.yaml — what this project actually sent out, and when.
 *
 * On a live project the dominant unit of work is a dated client-facing package: one project
 * carried 13 folders under `04_Presentation/` and 19 plot sets under `05_Plot/`, none of which
 * any Mi record described. Drawings track sheets and revisions, submissions track packages sent
 * to an authority; neither answers "what did the client see on the 5th, and what replaced it".
 *
 * This is a catalogue, not a copy: `package_path` points at the issued folder and is
 * human-confirmed like every other Dropbox path, so it stays null until someone selects it, and
 * nothing here is ever derived from a folder name. Every descriptive field defaults blank.
 */
export const projectDeliverableKindSchema = z.enum(["presentation", "plot", "other"]);
export type ProjectDeliverableKind = z.infer<typeof projectDeliverableKindSchema>;

export const projectDeliverableStatusSchema = z.enum(["draft", "issued", "superseded"]);
export type ProjectDeliverableStatus = z.infer<typeof projectDeliverableStatusSchema>;

export const projectDeliverableIdSchema = z.string().regex(
  /^[a-z0-9][a-z0-9-]{2,79}$/,
  "Use a lowercase id of letters, digits and hyphens, e.g. 2026-08-05-schematic-deck.",
);

/**
 * Cross-field rules shared by the stored record and the agent's draft (lib/projectCopilot.ts).
 * They must be the same rules: a proposal that validates into a review card and then fails on
 * confirm is the worst version of this, because the person only finds out after deciding.
 */
export function checkDeliverableConsistency(
  deliverable: {
    id: string;
    status: ProjectDeliverableStatus;
    issued_date: string | null;
    superseded_by: string | null;
  },
  context: z.RefinementCtx,
): void {
  if (deliverable.status === "issued" && !deliverable.issued_date) {
    context.addIssue({
      code: "custom",
      path: ["issued_date"],
      message: "An issued package needs the confirmed date it went out.",
    });
  }
  if (deliverable.status === "superseded" && !deliverable.superseded_by) {
    context.addIssue({
      code: "custom",
      path: ["superseded_by"],
      message: "A superseded package must name the deliverable that replaced it.",
    });
  }
  if (deliverable.superseded_by && deliverable.status !== "superseded") {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "A package replaced by another is superseded; set its status to match.",
    });
  }
  if (deliverable.superseded_by === deliverable.id) {
    context.addIssue({
      code: "custom",
      path: ["superseded_by"],
      message: "A deliverable cannot supersede itself.",
    });
  }
}

export const projectDeliverableSchema = z.object({
  id: projectDeliverableIdSchema,
  kind: projectDeliverableKindSchema,
  title: z.string().trim().min(1).max(240),
  /** Null until confirmed: a date parsed out of a folder name is a guess, not a record. */
  issued_date: dateOnlySchema.nullable().default(null),
  /** Who received it ("client", a name, a review board). Blank when unconfirmed. */
  audience: z.string().trim().max(200).default(""),
  /** Human-confirmed, relative to this project's folder. Never inferred from a scan. */
  package_path: projectRelativeRecordPathSchema.nullable().default(null),
  /** Rooms/areas the package covered, as the team names them. Free text on purpose. */
  spaces: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  status: projectDeliverableStatusSchema,
  superseded_by: projectDeliverableIdSchema.nullable().default(null),
  notes: z.string().trim().max(4_000).default(""),
}).superRefine(checkDeliverableConsistency);
export type ProjectDeliverable = z.infer<typeof projectDeliverableSchema>;

export const projectDeliverableIndexSchema = z.array(projectDeliverableSchema)
  .max(500)
  .superRefine((entries, context) => {
    const ids = new Set<string>();
    entries.forEach((entry, index) => {
      if (ids.has(entry.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `Duplicate deliverable id "${entry.id}".`,
        });
      }
      ids.add(entry.id);
    });
    // Caught here rather than per-entry: a supersession chain is only checkable against the
    // whole register, and a dangling pointer silently hides the replacement from the UI.
    entries.forEach((entry, index) => {
      if (entry.superseded_by && !ids.has(entry.superseded_by)) {
        context.addIssue({
          code: "custom",
          path: [index, "superseded_by"],
          message: `Deliverable "${entry.superseded_by}" is not in this register.`,
        });
      }
    });
  });

export type MepFaqFrontmatter = z.infer<typeof mepFaqFrontmatterSchema>;

/**
 * clients/<slug>.yaml — a client is a top-level entity like a project, not a
 * child list scoped inside one (unlike permits/status.yaml or
 * markups/index.yaml, which are always attributes of an already-identified
 * project folder).
 */
export const clientStatusSchema = z.enum(["active", "past", "prospect"]);
export type ClientStatus = z.infer<typeof clientStatusSchema>;

export const clientSchema = z.object({
  name: z.string(),
  short_summary: z.string().optional(),
  industry: z.string().optional(),
  primary_contact_name: z.string().optional(),
  contact_email: z.string().optional(),
  contact_phone: z.string().optional(),
  first_engaged: nullableDateStringSchema,
  status: clientStatusSchema,
  /**
   * This client's page id in Notion, for future linking — same discipline as
   * project.yaml's notion_page_id. Null until a human confirms the match;
   * nothing reads/writes this yet (repo-native for now, Notion link later).
   */
  notion_page_id: z.string().nullable().default(null),
});
export type Client = z.infer<typeof clientSchema>;

/** leads/<slug>.yaml — same top-level-entity layout as clients/. A lead precedes a project and may never convert. */
export const leadSourceSchema = z.enum([
  "referral",
  "website",
  "past-client",
  "cold-outreach",
  "social",
  "other",
]);
export type LeadSource = z.infer<typeof leadSourceSchema>;

export const leadStatusSchema = z.enum([
  "new",
  "qualified",
  "proposal-sent",
  "won",
  "lost",
  "on-hold",
]);
export type LeadStatus = z.infer<typeof leadStatusSchema>;

export const leadContractStageSchema = z.enum(["not-sent", "sent", "under-negotiation", "signed"]);
export type LeadContractStage = z.infer<typeof leadContractStageSchema>;

const leadDateSchema = dateStringSchema.refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a real calendar date in YYYY-MM-DD format.");

export const leadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  source: leadSourceSchema,
  /** The actual property owner / decision-maker we'd be contracting with — not whoever introduced the lead. See referrer_name for that. */
  contact_name: z.string().max(200).optional(),
  contact_email: z.union([z.string().email(), z.literal("")]).optional(),
  contact_phone: z.string().max(100).optional(),
  /** Who brought this lead to us (a referral contact, a collaborator) — distinct from contact_name, the owner. Often known before the owner's name is. */
  referrer_name: z.string().trim().max(200).default(""),
  date_received: leadDateSchema,
  status: leadStatusSchema,
  estimated_value: z.number().finite().nonnegative().nullable().default(null),
  notes: z.string().max(20_000).optional(),
  lost_reason: z.string().max(2_000).nullable().default(null),
  /** Slug of the projects/<slug>/ this lead became, once scaffolded via new-project. Human-set — never inferred. */
  converted_project_slug: z.string().nullable().default(null),
  /** Date the lead actually converted — set alongside converted_project_slug. Feeds getProjectTimeline. */
  converted_date: leadDateSchema.nullable().default(null),
  /**
   * Path to this lead's real Dropbox folder (site visit photos, contract
   * drafts, correspondence), relative to DROPBOX_ROOT — same discipline as
   * projectMetaSchema.dropbox_path. Null until a human confirms it; never
   * inferred from the lead name.
   */
  dropbox_path: z.string().nullable().default(null),
  /** Where contract back-and-forth stands, tracked separately from the coarser pipeline `status` above. */
  contract_stage: leadContractStageSchema.default("not-sent"),
  /** Freeform negotiation specifics — distinct from the coarse contract_stage enum above. */
  contract_notes: z.string().trim().default(""),
  /**
   * This lead's page id in the Notion Leads database — same discipline as
   * project.yaml's notion_page_id and clientSchema's notion_page_id. Set by
   * Mi itself the first time a Save successfully pushes the lead to Notion
   * (see app/api/leads/route.ts and app/api/leads/[slug]/route.ts); never
   * hand-guessed.
   */
  notion_page_id: z.string().nullable().default(null),
}).superRefine((lead, context) => {
  if (Boolean(lead.converted_project_slug) !== Boolean(lead.converted_date)) {
    context.addIssue({
      code: "custom",
      path: [lead.converted_project_slug ? "converted_date" : "converted_project_slug"],
      message: "Converted project and converted date must be supplied together.",
    });
  }
});
export type Lead = z.infer<typeof leadSchema>;

/** leads/<slug>/site-visits/index.yaml — one entry per site visit, newest usually last. */
export const siteVisitEntrySchema = z.object({
  id: z.string().min(1),
  date: dateOnlySchema,
  attendees: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().default(""),
});
export type SiteVisitEntry = z.infer<typeof siteVisitEntrySchema>;
export const siteVisitIndexSchema = z.array(siteVisitEntrySchema);

/** leads/<slug>/correspondence/index.yaml — a lightweight contact log, not a full transcript. */
export const communicationChannelSchema = z.enum(["call", "email", "in-person", "text", "other"]);
export const communicationEntrySchema = z.object({
  id: z.string().min(1),
  date: dateOnlySchema,
  channel: communicationChannelSchema,
  summary: z.string().trim().min(1),
});
export type CommunicationEntry = z.infer<typeof communicationEntrySchema>;
export const communicationIndexSchema = z.array(communicationEntrySchema);

/** leads/<slug>/site-photos/index.yaml — same "drop a file, index it" idiom as libraryDocumentSchema. */
export const leadPhotoEntrySchema = z.object({
  file: z.string().min(1),
  caption: z.string().trim().default(""),
  added_date: dateStringSchema,
});
export type LeadPhotoEntry = z.infer<typeof leadPhotoEntrySchema>;
export const leadPhotoIndexSchema = z.array(leadPhotoEntrySchema);

/**
 * permit-qaqc/<slug>/qaqc.yaml — STUDIO reviewing and stamping another firm's
 * drawing set before permit submission. A distinct service line from projects/
 * (STUDIO's own design work) and leads/ (prospective STUDIO clients): it has its
 * own Received/Sent/Admin/Reference folder taxonomy in Dropbox, no phases, and
 * — confirmed directly, not assumed — no Notion tracking today.
 */
export const permitQaqcStatusSchema = z.enum([
  "received",
  "in-review",
  "response-sent",
  "resubmitted",
  "closed",
]);
export type PermitQaqcStatus = z.infer<typeof permitQaqcStatusSchema>;

/** One received/response cycle for an engagement, mirroring the real Received/Sent Dropbox folders. */
export const permitQaqcRoundSchema = z.object({
  round_number: z.number().int().positive(),
  received_date: leadDateSchema,
  received_files: z.array(z.string().trim().min(1)).default([]),
  response_sent_date: leadDateSchema.nullable().default(null),
  response_files: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().max(20_000).optional(),
});
export type PermitQaqcRound = z.infer<typeof permitQaqcRoundSchema>;

export const permitQaqcEngagementSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** The firm whose drawings STUDIO is reviewing/stamping (e.g. "SampleConsultant", "SampleConsultant+Consultant") — free text, never inferred beyond a human-typed suggestion. */
  submitting_firm: z.string().trim().min(1).max(200),
  status: permitQaqcStatusSchema.default("received"),
  /**
   * Path to this engagement's real Dropbox folder, relative to DROPBOX_ROOT —
   * same discipline as project/lead dropbox_path: null until a human confirms
   * it, never inferred from the name. Unlike a new lead or project, this
   * folder already exists in Dropbox before Mi ever knows about the
   * engagement, so Mi only ever links to it here — it never creates it.
   */
  dropbox_path: z.string().nullable().default(null),
  /** The "03_" style numeric folder prefix — informational only, never enforced. */
  engagement_number: z.string().trim().max(20).nullable().default(null),
  rounds: z.array(permitQaqcRoundSchema).default([]),
  notes: z.string().max(20_000).optional(),
});
export type PermitQaqcEngagement = z.infer<typeof permitQaqcEngagementSchema>;
