import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const leads: Record<string, Record<string, unknown>> = {};
  const memoryAppends: { slug: string; title: string; entry: string }[] = [];
  const meetingWrites: { slug: string; meeting: Record<string, unknown> }[] = [];
  const existingMeetings: Record<string, { id: string; date: string }[]> = {};
  const engagements: Record<string, Record<string, unknown>> = {};
  return {
    leads,
    memoryAppends,
    meetingWrites,
    existingMeetings,
    engagements,
    projectSlugs: ["example-record-35"],
    getLead: vi.fn((slug: string) => {
      if (!leads[slug]) throw new Error(`Lead "${slug}" was not found.`);
      return { slug, lead: leads[slug] };
    }),
    getLeadWithHash: vi.fn((slug: string) => ({ slug, lead: leads[slug], hash: `hash-${slug}` })),
    updateLead: vi.fn((slug: string, lead: Record<string, unknown>) => {
      leads[slug] = lead;
      return { slug, lead };
    }),
    getProjectMemory: vi.fn(() => ({
      lastUpdated: "2026-08-01",
      sections: [{ title: "Existing note", body: "Kept." }],
      preamble: "",
      relativePath: "memory/notes.md",
    })),
    appendProjectMemoryNote: vi.fn((slug: string, note: { title: string; entry: string }) => {
      memoryAppends.push({ slug, ...note });
      return `projects/${slug}/memory/notes.md`;
    }),
    getMeetingNotes: vi.fn((slug: string) => existingMeetings[slug] ?? []),
    writeMeetingNote: vi.fn((slug: string, meeting: Record<string, unknown>) => {
      meetingWrites.push({ slug, meeting });
      return `projects/${slug}/meetings/${meeting.date}-${meeting.id}.md`;
    }),
    getPermitQaqcEngagement: vi.fn((slug: string) => {
      if (!engagements[slug]) throw new Error(`Permit QAQC engagement "${slug}" was not found.`);
      return { slug, engagement: engagements[slug] };
    }),
    getPermitQaqcEngagementWithHash: vi.fn((slug: string) => ({
      slug,
      engagement: engagements[slug],
      hash: `hash-${slug}`,
    })),
    updatePermitQaqcEngagement: vi.fn((slug: string, engagement: Record<string, unknown>) => {
      engagements[slug] = engagement;
      return { slug, engagement };
    }),
  };
});

vi.mock("./leads", () => ({ getLead: mocks.getLead, getLeadWithHash: mocks.getLeadWithHash }));
vi.mock("./leadMutations", () => ({ updateLead: mocks.updateLead }));
vi.mock("./projects", () => ({ getProjectSlugs: () => mocks.projectSlugs }));
vi.mock("./permitQaqc", () => ({
  getPermitQaqcEngagement: mocks.getPermitQaqcEngagement,
  getPermitQaqcEngagementWithHash: mocks.getPermitQaqcEngagementWithHash,
}));
vi.mock("./permitQaqcMutations", () => ({
  updatePermitQaqcEngagement: mocks.updatePermitQaqcEngagement,
}));
vi.mock("./projectWorkspace", () => ({
  getProjectMemory: mocks.getProjectMemory,
  appendProjectMemoryNote: mocks.appendProjectMemoryNote,
  getMeetingNotes: mocks.getMeetingNotes,
  writeMeetingNote: mocks.writeMeetingNote,
}));

import { reviewCardSchema, type ReviewCard } from "./reviewInbox";
import {
  applyReviewCardToDestination,
  describeDestinations,
  planBulkApply,
  renderNoteSection,
  ReviewApplyError,
  visibilityAllowsDestination,
} from "./reviewInboxApply";

const LEAD_SLUG = "1000-w-example-blvd";
const QAQC_SLUG = "1005-s-example-ave";

function engagement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "1005 S Example Ave",
    submitting_firm: "Consultant",
    status: "received",
    dropbox_path: null,
    engagement_number: null,
    rounds: [],
    notes: "",
    ...overrides,
  };
}

function lead(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "example-record-70",
    source: "referral",
    date_received: "2026-07-15",
    status: "qualified",
    estimated_value: null,
    notes: "",
    lost_reason: null,
    referrer_name: "",
    contract_stage: "not-sent",
    contract_notes: "",
    converted_project_slug: null,
    converted_date: null,
    dropbox_path: null,
    notion_page_id: null,
    ...overrides,
  };
}

function card(overrides: Partial<ReviewCard> = {}): ReviewCard {
  return reviewCardSchema.parse({
    id: "entry-abc123",
    status: "pending",
    workspace: { type: "lead", slug: LEAD_SLUG },
    entry_kind: "meeting",
    source: {
      file_name: "entry-abc123.json",
      path: "Mi/inbox/entry-abc123.json",
      entry_id: "entry-abc123",
      hash: "a".repeat(64),
      created_at: "2026-08-15T15:14:29.167-05:00",
      session_id: "codex-session-id",
      agent: "codex",
    },
    visibility: "internal",
    needs_confirmation: true,
    imported_at: "2026-08-15T21:00:00.000Z",
    original: {
      title: "Owner walkthrough",
      body: [
        "Date: 2026-08-14 14:00-15:30 America/Chicago",
        "Attendees: Example Client, Example User",
        "## Summary",
        "Walked the second floor.",
        "## Decisions",
        "- Keep the existing stair.",
        "## Action items",
        "- Price the panel relocation (owner: Alex) (due 2026-09-01)",
      ].join("\n"),
      why: "The stair decision changes the plan set.",
      visibility: "internal",
      evidence: [{ path: "06_Corr/26_0814_Walkthrough.pdf", quote: "" }],
      targets: [],
    },
    ...overrides,
  });
}

beforeEach(() => {
  for (const key of Object.keys(mocks.leads)) delete mocks.leads[key];
  for (const key of Object.keys(mocks.existingMeetings)) delete mocks.existingMeetings[key];
  mocks.leads[LEAD_SLUG] = lead();
  for (const key of Object.keys(mocks.engagements)) delete mocks.engagements[key];
  mocks.engagements[QAQC_SLUG] = engagement();
  mocks.updatePermitQaqcEngagement.mockClear();
  mocks.memoryAppends.length = 0;
  mocks.meetingWrites.length = 0;
  mocks.updateLead.mockClear();
  mocks.appendProjectMemoryNote.mockClear();
  mocks.writeMeetingNote.mockClear();
});

describe("renderNoteSection", () => {
  it("dates the section from the meeting, not from when Mi imported it", () => {
    const subject = card();
    const section = renderNoteSection({
      card: subject,
      content: subject.original!,
      details: null,
      reviewedBy: "Example User",
      confirmedAt: "2026-08-20T18:00:00.000Z",
    });
    // The entry was recorded on the 15th; the meeting itself was on the 14th. Neither is the
    // confirmation date, and using the confirmation date would misdate the record.
    expect(section.heading).toBe("Meeting note — 2026-08-15 — Owner walkthrough");
  });

  it("names the source file, session, agent, visibility, and who confirmed it", () => {
    const subject = card();
    const section = renderNoteSection({
      card: subject,
      content: subject.original!,
      details: null,
      reviewedBy: "Example User",
      confirmedAt: "2026-08-20T18:00:00.000Z",
    });
    expect(section.body).toContain("Mi/inbox/entry-abc123.json");
    expect(section.body).toContain("codex");
    expect(section.body).toContain("codex-session-id");
    expect(section.body).toContain("Visibility: internal");
    expect(section.body).toContain("Example User");
  });
});

describe("describeDestinations", () => {
  it("offers Lead Notes with the exact existing and added content", () => {
    mocks.leads[LEAD_SLUG] = lead({ notes: "Original hand-written note." });
    const [option] = describeDestinations("lead", LEAD_SLUG, card());

    expect(option).toMatchObject({
      label: "Confirm and add to Lead Notes",
      record: "lead.yaml → notes",
      mode: "append",
      available: true,
      current: "Original hand-written note.",
    });
    expect(option.proposed).toContain("## Meeting note — 2026-08-14 — Owner walkthrough");
    expect(option.proposed).toContain("Keep the existing stair.");
  });

  it("offers Project Notes only once a lead has been converted", () => {
    expect(describeDestinations("lead", LEAD_SLUG, card())
      .some((option) => option.ref.kind === "project-notes")).toBe(false);

    mocks.leads[LEAD_SLUG] = lead({
      converted_project_slug: "example-record-35",
      converted_date: "2026-08-01",
    });
    const projectOption = describeDestinations("lead", LEAD_SLUG, card())
      .find((option) => option.ref.kind === "project-notes");
    expect(projectOption).toMatchObject({ available: true, mode: "append" });
    expect(projectOption?.record).toBe("projects/example-record-35/memory/notes.md → new section");
  });

  it("refuses rather than truncates when the append would overrun the notes field", () => {
    mocks.leads[LEAD_SLUG] = lead({ notes: "x".repeat(19_900) });
    const [option] = describeDestinations("lead", LEAD_SLUG, card());
    expect(option.available).toBe(false);
    expect(option.unavailableReason).toContain("20,000-character limit");
  });

  it("explains itself instead of offering nothing when the record cannot be read", () => {
    const [option] = describeDestinations("permit-qaqc", "some-engagement", card({
      workspace: { type: "permit-qaqc", slug: "some-engagement" },
    }));
    expect(option.available).toBe(false);
    expect(option.unavailableReason).toContain("was not found");
  });

  it("reuses the existing lead proposal validator for record-field changes", () => {
    const withTarget = card({
      entry_kind: "record-change",
      original: {
        ...card().original!,
        targets: [{ record: "lead.yaml", field: "contract_stage", proposed: "sent", current: "not-sent" }],
      },
    });
    const option = describeDestinations("lead", LEAD_SLUG, withTarget)
      .find((candidate) => candidate.ref.kind === "lead-record-field");
    expect(option).toMatchObject({ available: true, mode: "replace" });
    expect(option?.current).toBe("contract_stage: not-sent");
    expect(option?.proposed).toBe("contract_stage: sent");
  });

  it("offers a meeting entry its own meeting note, ahead of Project Notes", () => {
    const options = describeDestinations("project", "example-record-35", card({
      workspace: { type: "project", slug: "example-record-35" },
    }));
    expect(options[0]).toMatchObject({
      label: "Confirm and save as a Meeting",
      available: true,
    });
    expect(options[0].ref.kind).toBe("project-meeting");
    expect(options[0].record).toContain("projects/example-record-35/meetings/2026-08-14-");
    expect(options[0].proposed).toContain("2026-08-14 14:00–15:30 America/Chicago");
    expect(options[0].proposed).toContain("Attendees: Example Client, Example User");
    expect(options.some((option) => option.ref.kind === "project-notes")).toBe(true);
  });

  it("will not date a meeting the entry never dated, and says so", () => {
    const undated = card({
      workspace: { type: "project", slug: "example-record-35" },
      original: { ...card().original!, body: "Attendees: Example User\n\nTalked about the stair last Tuesday." },
    });
    const option = describeDestinations("project", "example-record-35", undated)
      .find((candidate) => candidate.ref.kind === "project-meeting");
    expect(option?.available).toBe(false);
    expect(option?.unavailableReason).toContain("never stated an absolute meeting date");
  });

  it("does not offer a meeting note for an entry that is not a meeting", () => {
    const fact = card({
      workspace: { type: "project", slug: "example-record-35" },
      entry_kind: "fact",
    });
    expect(describeDestinations("project", "example-record-35", fact)
      .some((option) => option.ref.kind === "project-meeting")).toBe(false);
  });

  it("refuses to file the same entry as a second meeting note on the same date", () => {
    const subject = card({ workspace: { type: "project", slug: "example-record-35" } });
    const [first] = describeDestinations("project", "example-record-35", subject);
    const filed = /meetings\/(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)\.md/.exec(first.record);
    mocks.existingMeetings["example-record-35"] = [{ date: filed![1], id: filed![2] }];

    const option = describeDestinations("project", "example-record-35", subject)
      .find((candidate) => candidate.ref.kind === "project-meeting");
    expect(option?.available).toBe(false);
    expect(option?.unavailableReason).toContain("already filed as a meeting note");
  });

  it("declines a field the lead proposal allowlist does not cover, with the reason", () => {
    const withTarget = card({
      entry_kind: "record-change",
      original: {
        ...card().original!,
        targets: [{ record: "lead.yaml", field: "notion_page_id", proposed: "guessed-id", current: "" }],
      },
    });
    const option = describeDestinations("lead", LEAD_SLUG, withTarget)
      .find((candidate) => candidate.ref.kind === "lead-record-field");
    expect(option?.available).toBe(false);
    expect(option?.unavailableReason).toContain("notion_page_id");
  });
});

describe("applyReviewCardToDestination", () => {
  it("appends to Lead Notes without touching a single character of what was there", () => {
    mocks.leads[LEAD_SLUG] = lead({ notes: "Original hand-written note.\nSecond line." });

    const outcome = applyReviewCardToDestination({
      kind: "lead",
      slug: LEAD_SLUG,
      card: card(),
      destinationKind: "lead-notes",
      reviewedBy: "Example User",
      now: () => new Date("2026-08-20T18:00:00.000Z"),
    });

    const saved = String(mocks.leads[LEAD_SLUG].notes);
    expect(saved.startsWith("Original hand-written note.\nSecond line.")).toBe(true);
    expect(saved).toContain("## Meeting note — 2026-08-14 — Owner walkthrough");
    expect(outcome.record).toBe("lead.yaml → notes");
    expect(outcome.result).toContain("preserved");
  });

  it("writes through updateLead behind the hash captured at read time", () => {
    applyReviewCardToDestination({
      kind: "lead",
      slug: LEAD_SLUG,
      card: card(),
      destinationKind: "lead-notes",
      reviewedBy: "Example User",
    });
    expect(mocks.updateLead).toHaveBeenCalledWith(
      LEAD_SLUG,
      expect.objectContaining({ name: "example-record-70" }),
      { expectedHash: `hash-${LEAD_SLUG}` },
    );
  });

  it("prefers an edited card over the agent's original when writing", () => {
    const edited = card({
      edited: {
        title: "Owner walkthrough (corrected)",
        body: "Corrected body.",
        why: "",
        visibility: "internal",
        meeting: null,
        targets: [],
        evidence: [],
      },
    });
    applyReviewCardToDestination({
      kind: "lead",
      slug: LEAD_SLUG,
      card: edited,
      destinationKind: "lead-notes",
      reviewedBy: "Example User",
    });
    const saved = String(mocks.leads[LEAD_SLUG].notes);
    expect(saved).toContain("Owner walkthrough (corrected)");
    expect(saved).toContain("Corrected body.");
  });

  it("appends a section to project notes rather than rewriting the file", () => {
    const outcome = applyReviewCardToDestination({
      kind: "project",
      slug: "example-record-35",
      card: card({ workspace: { type: "project", slug: "example-record-35" } }),
      destinationKind: "project-notes",
      reviewedBy: "Example User",
    });
    expect(mocks.appendProjectMemoryNote).toHaveBeenCalledTimes(1);
    expect(mocks.memoryAppends[0]).toMatchObject({ slug: "example-record-35" });
    expect(mocks.memoryAppends[0].title).toContain("Owner walkthrough");
    expect(outcome.record).toContain("memory/notes.md");
  });

  it("files a meeting entry as a real meeting note, keeping the full note as raw notes", () => {
    const outcome = applyReviewCardToDestination({
      kind: "project",
      slug: "example-record-35",
      card: card({ workspace: { type: "project", slug: "example-record-35" } }),
      destinationKind: "project-meeting",
      reviewedBy: "Example User",
      now: () => new Date("2026-08-20T18:00:00.000Z"),
    });

    expect(mocks.writeMeetingNote).toHaveBeenCalledTimes(1);
    const written = mocks.meetingWrites[0].meeting as Record<string, unknown>;
    expect(mocks.meetingWrites[0].slug).toBe("example-record-35");
    expect(written).toMatchObject({
      title: "Owner walkthrough",
      date: "2026-08-14",
      start_time: "14:00",
      end_time: "15:30",
      timezone: "America/Chicago",
      meeting_status: "completed",
      visibility: "internal",
      attendees: ["Example Client", "Example User"],
      decisions: ["Keep the existing stair."],
    });
    expect(written.summary).toContain("Walked the second floor.");
    // The action item keeps its owner and its due date, both stated in the entry.
    expect(written.action_items).toEqual([
      { description: "Price the panel relocation", owner: "Alex", due_date: "2026-09-01" },
    ]);
    // Provenance and anything the meeting schema has no field for survive in raw notes.
    expect(String(written.raw_notes)).toContain("Mi/inbox/entry-abc123.json");
    expect(String(written.raw_notes)).toContain("The stair decision changes the plan set.");
    expect(outcome.record).toBe("projects/example-record-35/meetings/2026-08-14-entry-abc123.md");
    expect(outcome.result).toContain("2026-08-14");
  });

  it("refuses an undated meeting entry instead of filing it under today", () => {
    expect(() => applyReviewCardToDestination({
      kind: "project",
      slug: "example-record-35",
      card: card({
        workspace: { type: "project", slug: "example-record-35" },
        original: { ...card().original!, body: "Talked about the stair last Tuesday." },
      }),
      destinationKind: "project-meeting",
      reviewedBy: "Example User",
    })).toThrow(ReviewApplyError);
    expect(mocks.writeMeetingNote).not.toHaveBeenCalled();
  });

  it("fails with a readable reason rather than half-writing when the field would overrun", () => {
    mocks.leads[LEAD_SLUG] = lead({ notes: "x".repeat(19_900) });
    expect(() => applyReviewCardToDestination({
      kind: "lead",
      slug: LEAD_SLUG,
      card: card(),
      destinationKind: "lead-notes",
      reviewedBy: "Example User",
    })).toThrow(ReviewApplyError);
    expect(mocks.updateLead).not.toHaveBeenCalled();
  });
});

describe("visibility", () => {
  it("keeps an internal entry out of any client-facing destination", () => {
    /*
     * Every destination Mi writes today is internal, so this guard is what makes adding a
     * client-facing one safe: the applier refuses before the write rather than relying on
     * the new destination to remember.
     */
    expect(visibilityAllowsDestination("internal", "client")).toBe(false);
    expect(visibilityAllowsDestination("client-visible", "client")).toBe(true);
    expect(visibilityAllowsDestination("internal", "internal")).toBe(true);
  });
});

describe("planBulkApply", () => {
  const clean = [card({ id: "entry-one" }), card({ id: "entry-two" })];

  it("binds confirmation to the exact reviewed card content", () => {
    const input = { kind: "lead" as const, slug: LEAD_SLUG, cards: clean, destinationKind: "lead-notes" as const };
    const preview = planBulkApply(input);
    expect(planBulkApply(input).fingerprint).toBe(preview.fingerprint);
    const changed = { ...clean[0], original: { ...clean[0].original!, body: "Changed after preview" } };
    expect(planBulkApply({ ...input, cards: [changed, clean[1]] }).fingerprint).not.toBe(preview.fingerprint);
    expect(preview.effects[0].proposed).toBeTruthy();
  });

  it("allows a clean same-workspace set and states the combined effect first", () => {
    const plan = planBulkApply({
      kind: "lead",
      slug: LEAD_SLUG,
      cards: clean,
      destinationKind: "lead-notes",
    });
    expect(plan.allowed).toBe(true);
    expect(plan.effects).toHaveLength(2);
    expect(plan.effects[0].record).toBe("lead.yaml → notes");
    expect(plan.effects[0].summary).toContain("Appends a dated section");
  });

  it("refuses a selection spanning two workspaces", () => {
    const plan = planBulkApply({
      kind: "lead",
      slug: LEAD_SLUG,
      cards: [clean[0], card({ id: "entry-other", workspace: { type: "lead", slug: "other-lead" } })],
      destinationKind: "lead-notes",
    });
    expect(plan.allowed).toBe(false);
    expect(plan.blockers.join(" ")).toContain("more than one workspace");
  });

  it("refuses when a selected card is no longer pending", () => {
    const plan = planBulkApply({
      kind: "lead",
      slug: LEAD_SLUG,
      cards: [clean[0], card({ id: "entry-done", status: "applied" })],
      destinationKind: "lead-notes",
    });
    expect(plan.allowed).toBe(false);
    expect(plan.blockers.join(" ")).toContain("no longer pending");
  });

  it("refuses when two cards claim the same record field with different values", () => {
    const target = (proposed: string) => ({
      ...card().original!,
      targets: [{ record: "lead.yaml", field: "contract_stage", proposed, current: "not-sent" }],
    });
    const plan = planBulkApply({
      kind: "lead",
      slug: LEAD_SLUG,
      cards: [
        card({ id: "entry-a", entry_kind: "record-change", original: target("sent") }),
        card({ id: "entry-b", entry_kind: "record-change", original: target("signed") }),
      ],
      destinationKind: "lead-record-field",
    });
    expect(plan.allowed).toBe(false);
    expect(plan.blockers.join(" ")).toContain("different values for lead.yaml.contract_stage");
  });

  it("refuses an unavailable destination rather than partially applying", () => {
    mocks.leads[LEAD_SLUG] = lead({ notes: "x".repeat(19_900) });
    const plan = planBulkApply({
      kind: "lead",
      slug: LEAD_SLUG,
      cards: clean,
      destinationKind: "lead-notes",
    });
    expect(plan.allowed).toBe(false);
    expect(plan.blockers[0]).toContain("20,000-character limit");
  });
});

describe("permit QAQC destinations", () => {
  const NOTES = "qaqc.yaml \u2192 notes";

  function qaqcCard(overrides: Partial<ReviewCard> = {}): ReviewCard {
    return card({
      id: "entry-qaqc-one",
      entry_kind: "risk",
      workspace: { type: "permit-qaqc", slug: QAQC_SLUG },
      original: {
        ...card().original!,
        title: "A100 matrix: Z.01 zoning district row is blank",
        body: "Z.01 is empty across every column on the stamped set.",
      },
      ...overrides,
    });
  }

  it("offers Engagement Notes instead of the no-destination placeholder", () => {
    const options = describeDestinations("permit-qaqc", QAQC_SLUG, qaqcCard());
    expect(options.map((option) => option.ref.kind)).toEqual(["qaqc-notes"]);
    expect(options[0].available).toBe(true);
    expect(options[0].record).toBe(NOTES);
    expect(options[0].label).toBe("Confirm and add to Engagement Notes");
    expect(options[0].proposed).toContain("Z.01 zoning district row is blank");
  });

  it("appends to the engagement record under its read hash, preserving what is there", () => {
    mocks.engagements[QAQC_SLUG] = engagement({ notes: "Existing partner note." });
    const outcome = applyReviewCardToDestination({
      kind: "permit-qaqc",
      slug: QAQC_SLUG,
      card: qaqcCard(),
      destinationKind: "qaqc-notes",
      reviewedBy: "Example User",
    });

    expect(outcome.record).toBe(NOTES);
    const [slug, written, options] = mocks.updatePermitQaqcEngagement.mock.calls[0];
    expect(slug).toBe(QAQC_SLUG);
    expect(options).toEqual({ expectedHash: `hash-${QAQC_SLUG}` });
    const notes = (written as { notes: string }).notes;
    expect(notes.startsWith("Existing partner note.")).toBe(true);
    expect(notes).toContain("A100 matrix: Z.01 zoning district row is blank");
    expect(notes).toContain("by Example User");
  });

  it("refuses the destination once the notes field would overflow", () => {
    mocks.engagements[QAQC_SLUG] = engagement({ notes: "x".repeat(19_900) });
    const options = describeDestinations("permit-qaqc", QAQC_SLUG, qaqcCard());
    expect(options[0].available).toBe(false);
    expect(options[0].unavailableReason).toContain("20,000-character limit");
  });

  it("refuses to write engagement notes from a workspace that has none", () => {
    expect(() => applyReviewCardToDestination({
      kind: "lead",
      slug: LEAD_SLUG,
      card: card(),
      destinationKind: "qaqc-notes",
      reviewedBy: "Example User",
    })).toThrow(ReviewApplyError);
  });

  it("clears a whole engagement's pending cards in one bulk plan", () => {
    const plan = planBulkApply({
      kind: "permit-qaqc",
      slug: QAQC_SLUG,
      cards: [qaqcCard(), qaqcCard({ id: "entry-qaqc-two" }), qaqcCard({ id: "entry-qaqc-three" })],
      destinationKind: "qaqc-notes",
    });
    expect(plan.allowed).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.effects).toHaveLength(3);
    expect(plan.effects[0].record).toBe(NOTES);
  });
});
