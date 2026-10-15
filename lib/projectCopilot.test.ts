import { describe, expect, it } from "vitest";
import {
  parseProjectCopilotReply,
  parseProjectProposalSource,
  projectCopilotEnvelopeSchema,
  projectCopilotProposalSchema,
  projectDetailsPatchSchema,
} from "./projectCopilot";
import { meetingAgendaMinutes } from "./meetingAgenda";
import { projectMetaPatchSchema } from "./schema";

describe("project copilot reply parser", () => {
  it("separates conversational text from validated proposals", () => {
    const reply = parseProjectCopilotReply(`I found one item to review.

\`\`\`mi-proposals
{"version":1,"proposals":[{"id":"client-update-1","kind":"project-details","title":"Add client","reason":"Named in the meeting notes","data":{"client_name":"Acme LLC"}}]}
\`\`\``);

    expect(reply.text).toBe("I found one item to review.");
    expect(reply.proposals).toHaveLength(1);
    expect(reply.proposals[0]).toMatchObject({ kind: "project-details", data: { client_name: "Acme LLC" } });
    expect(reply.proposalError).toBeNull();
  });

  it("never exposes malformed output as an actionable proposal", () => {
    const reply = parseProjectCopilotReply(`Review this.\n\`\`\`mi-proposals\n{"version":1,"proposals":[{"kind":"time-entry","data":{"hours":-3}}]}\n\`\`\``);

    expect(reply.text).toBe("Review this.");
    expect(reply.proposals).toEqual([]);
    expect(reply.proposalError).toContain("could not validate");
    expect(reply.proposalError).toContain("proposals[0].id");
  });

  it("validates bare JSON proposal files with the same schema and strips a UTF-8 BOM", () => {
    const envelope = {
      version: 1,
      proposals: [{
        id: "file-note",
        kind: "memory-note",
        title: "File note",
        reason: "The terminal wrote an exact proposal file.",
        data: { entry: "Keep this durable fact." },
      }],
    };
    const reply = parseProjectProposalSource(`\uFEFF${JSON.stringify(envelope)}`);
    expect(reply.proposalError).toBeNull();
    expect(reply.proposals).toHaveLength(1);
  });

  it("rejects a non-object proposal file root and reports field paths", () => {
    expect(parseProjectProposalSource("[]").proposalError).toContain("JSON object");
    const invalid = parseProjectProposalSource(JSON.stringify({
      version: 1,
      proposals: [{
        id: "bad-team",
        kind: "project-details",
        title: "Bad team",
        reason: "Regression fixture.",
        data: { team: ["Example User"] },
      }],
    }));
    expect(invalid.proposalError).toContain("proposals[0].data.team[0]");
  });

  it("leaves ordinary conversation unchanged", () => {
    expect(parseProjectCopilotReply("What date was the permit submitted?")).toEqual({
      text: "What date was the permit submitted?",
      proposals: [],
      proposalError: null,
    });
  });

  it("parses a planned, timeboxed meeting agenda for human review", () => {
    const proposal = {
      id: "plan-client-contract-meeting",
      kind: "meeting-note",
      title: "Plan client contract meeting",
      reason: "The user asked Mi to structure the upcoming client conversation.",
      data: {
        id: "client-contract-meeting",
        title: "Client contract meeting",
        meeting_type: "Client Meeting",
        meeting_status: "planned",
        date: "2026-08-12",
        start_time: "10:00",
        end_time: "11:00",
        timezone: "America/Chicago",
        attendees: [],
        objective: "Review the contract and agree on next steps.",
        preparation: ["Review the latest contract."],
        agenda_items: [
          { topic: "Contract review", duration_minutes: 25, desired_outcome: "Resolve scope questions." },
          { topic: "Project priorities", duration_minutes: 35, desired_outcome: "Confirm next actions." },
        ],
        raw_notes: "",
        summary: "",
        decisions: [],
        action_items: [],
        open_questions: [],
      },
    };
    const reply = parseProjectCopilotReply(
      `Review this agenda.\n\`\`\`mi-proposals\n${JSON.stringify({ version: 1, proposals: [proposal] })}\n\`\`\``,
    );

    expect(reply.proposalError).toBeNull();
    expect(reply.proposals[0]).toMatchObject({
      kind: "meeting-note",
      data: { meeting_status: "planned", objective: proposal.data.objective },
    });
    if (reply.proposals[0]?.kind === "meeting-note") {
      expect(meetingAgendaMinutes(reply.proposals[0].data.agenda_items)).toBe(60);
    }
  });

  it("rejects multiple proposal envelopes", () => {
    const block = "```mi-proposals\n{\"version\":1,\"proposals\":[]}\n```";
    const reply = parseProjectCopilotReply(`${block}\n${block}`);
    expect(reply.proposals).toEqual([]);
    expect(reply.proposalError).toContain("more than one");
  });

  it("accepts memory-note and review-finding proposals", () => {
    const proposals = [
      {
        id: "memory-address-fix",
        kind: "memory-note",
        title: "Confirmed address",
        reason: "The user corrected it in chat.",
        data: { entry: "The address is 1002 S Example Blvd, not 2828." },
      },
      {
        id: "review-occupant-load",
        kind: "review-finding",
        title: "Occupant load discrepancy",
        reason: "The letter's operational cap is lower than the code-calculated load.",
        data: {
          discipline: "architectural",
          status: "open",
          related_markups: [],
          related_code_sections: [],
          finding: "Code-calculated occupant load (231-255) exceeds the letter's cap of 120.",
          recommendation: "Needs fire marshal/DOB sign-off before permit submission.",
        },
      },
    ];
    const reply = parseProjectCopilotReply(
      `Two things worth tracking.\n\`\`\`mi-proposals\n${JSON.stringify({ version: 1, proposals })}\n\`\`\``,
    );

    expect(reply.proposalError).toBeNull();
    expect(reply.proposals).toHaveLength(2);
    expect(reply.proposals[0]).toMatchObject({ kind: "memory-note" });
    expect(reply.proposals[1]).toMatchObject({ kind: "review-finding", data: { discipline: "architectural" } });
  });

  it("accepts a deliverable proposal and refuses to carry a package folder path", () => {
    const proposals = [
      {
        id: "deck-2026-08-05",
        kind: "deliverable",
        title: "Schematic review deck",
        reason: "The meeting note records what was presented on the 5th.",
        data: {
          id: "2026-08-05-schematic-deck",
          kind: "presentation",
          title: "Schematic design review",
          issued_date: "2026-08-05",
          audience: "Client",
          spaces: ["Lobby", "Dining"],
          status: "issued",
          superseded_by: null,
          notes: "",
          // A Dropbox path is human-confirmed: the contract has no field for it, so an agent
          // that supplies one anyway must not have it silently stored.
          package_path: "04_Presentation/2026-08-05 Client Review",
        },
      },
    ];
    const reply = parseProjectCopilotReply(
      `Recording the deck.\n\`\`\`mi-proposals\n${JSON.stringify({ version: 1, proposals })}\n\`\`\``,
    );

    expect(reply.proposalError).toBeNull();
    expect(reply.proposals[0]).toMatchObject({
      kind: "deliverable",
      data: { id: "2026-08-05-schematic-deck", status: "issued" },
    });
    expect(reply.proposals[0]?.data).not.toHaveProperty("package_path");
  });

  it("rejects a deliverable marked issued without a confirmed date", () => {
    const proposals = [
      {
        id: "deck-undated",
        kind: "deliverable",
        title: "Undated deck",
        reason: "Folder name suggested a date.",
        data: {
          id: "undated-deck",
          kind: "presentation",
          title: "Undated deck",
          issued_date: null,
          audience: "",
          spaces: [],
          status: "issued",
          superseded_by: null,
          notes: "",
        },
      },
    ];
    const reply = parseProjectCopilotReply(
      `\`\`\`mi-proposals\n${JSON.stringify({ version: 1, proposals })}\n\`\`\``,
    );

    expect(reply.proposals).toEqual([]);
    expect(reply.proposalError).toMatch(/could not validate/i);
  });

  it("rejects duplicate proposal ids within one envelope", () => {
    const proposal = {
      id: "same-id",
      kind: "project-details",
      title: "Update client",
      reason: "The user supplied it.",
      data: { client_name: "Acme" },
    };
    const reply = parseProjectCopilotReply(
      `Review these.\n\`\`\`mi-proposals\n${JSON.stringify({ version: 1, proposals: [proposal, proposal] })}\n\`\`\``,
    );

    expect(reply.proposals).toEqual([]);
    expect(reply.proposalError).toContain("must be unique");
  });

  it("accepts only proposal-state decision records and review-required site reports", () => {
    const proposals = [
      {
        id: "record-lobby-direction",
        kind: "decision-record",
        title: "Record lobby direction",
        reason: "The meeting note identifies an outcome that still needs human confirmation.",
        data: {
          version: 1,
          id: "decision-lobby-direction",
          title: "Lobby direction",
          status: "proposed",
          decision_date: "2026-07-28",
          confirmed_by: null,
          deciders: ["Owner"],
          context: "Meeting discussion.",
          options: [],
          outcome: "Use wood slats.",
          rationale: "",
          consequences: [],
          affected_deliverables: [],
          sources: [{
            kind: "meeting",
            label: "Owner meeting",
            path: "meetings/2026-07-28-owner.md",
            item_id: "decision-1",
          }],
          supersedes: null,
          superseded_by: null,
        },
      },
      {
        id: "draft-site-walk",
        kind: "site-report",
        title: "Draft site walk",
        reason: "Turn the supplied field notes into categorized review material.",
        data: {
          version: 1,
          id: "site-report-site-walk",
          title: "Site walk",
          status: "draft",
          origin: "ai-assisted",
          visit_date: "2026-07-28",
          confirmed_by: null,
          purpose: "Existing conditions",
          scope: "Visible lobby",
          participants: [],
          conditions: {},
          sources: [],
          items: [{
            id: "O1",
            kind: "direct-observation",
            location: "Lobby",
            text: "Visible terrazzo floor.",
            source_refs: [],
            photo_refs: [],
          }],
          raw_notes: "",
          professional_review_required: true,
        },
      },
    ];
    const reply = parseProjectCopilotReply(
      `Review these.\n\`\`\`mi-proposals\n${JSON.stringify({ version: 1, proposals })}\n\`\`\``,
    );

    expect(reply.proposalError).toBeNull();
    expect(reply.proposals.map((proposal) => proposal.kind)).toEqual([
      "decision-record",
      "site-report",
    ]);

    const invalid = structuredClone(proposals[0]);
    invalid.data.status = "decided";
    const rejected = parseProjectCopilotReply(
      `\`\`\`mi-proposals\n${JSON.stringify({ version: 1, proposals: [invalid] })}\n\`\`\``,
    );
    expect(rejected.proposals).toEqual([]);
  });
});

describe("project-meta proposal kind", () => {
  it("parses a valid building_type/occupancy_group patch", () => {
    const result = projectCopilotProposalSchema.safeParse({
      id: "meta-1",
      kind: "project-meta",
      title: "Set building type and occupancy",
      reason: "The user described a mixed-use build with retail and multifamily units.",
      data: { building_type: "mixed-use", occupancy_group: ["R-2", "B"] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        kind: "project-meta",
        data: { building_type: "mixed-use", occupancy_group: ["R-2", "B"] },
      });
    }
  });

  it("parses a partial patch containing only one of the two allowed fields", () => {
    const result = projectCopilotProposalSchema.safeParse({
      id: "meta-2",
      kind: "project-meta",
      title: "Set occupancy only",
      reason: "Only occupancy was confirmed this step.",
      data: { occupancy_group: ["B"] },
    });
    expect(result.success).toBe(true);
  });

  /**
   * This is the load-bearing regression test for projectMetaPatchSchema's
   * .strict() call in lib/schema.ts: a malformed/crafted model reply must
   * never be able to smuggle project.yaml fields this AI-facing path was
   * never meant to touch (status is computed/synced, notion_page_id is
   * human-confirmed-only). It must fail closed -- rejected, not silently
   * stripped -- and the rejection must specifically be the unrecognized-key
   * failure from .strict(), not some unrelated validation error.
   */
  it("rejects a payload smuggling status/notion_page_id through .strict()", () => {
    const result = projectCopilotProposalSchema.safeParse({
      id: "meta-3",
      kind: "project-meta",
      title: "Sneaky update",
      reason: "attempted smuggling",
      data: {
        building_type: "office",
        status: "complete",
        notion_page_id: "smuggled-notion-id",
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const unrecognizedIssue = result.error.issues.find((issue) => issue.code === "unrecognized_keys");
      expect(unrecognizedIssue).toBeDefined();
      expect((unrecognizedIssue as { keys?: string[] } | undefined)?.keys).toEqual(
        expect.arrayContaining(["status", "notion_page_id"]),
      );
    }
  });

  it("also rejects other unrelated project.yaml fields smuggled alone (dropbox_path, client_id)", () => {
    const dropboxAttempt = projectCopilotProposalSchema.safeParse({
      id: "meta-4",
      kind: "project-meta",
      title: "Sneaky",
      reason: "attempted smuggling",
      data: { dropbox_path: "1.00 PROJECTS/should-not-be-settable" },
    });
    expect(dropboxAttempt.success).toBe(false);

    const clientIdAttempt = projectCopilotProposalSchema.safeParse({
      id: "meta-5",
      kind: "project-meta",
      title: "Sneaky",
      reason: "attempted smuggling",
      data: { client_id: "some-client-slug" },
    });
    expect(clientIdAttempt.success).toBe(false);
  });

  it("keeps the 20-proposal envelope max when project-meta proposals are included", () => {
    const proposals = Array.from({ length: 21 }, (_, index) => ({
      id: `meta-batch-${index}`,
      kind: "project-meta" as const,
      title: "Set building type",
      reason: "Batch regression check.",
      data: { building_type: "office" as const },
    }));
    const envelope = projectCopilotEnvelopeSchema.safeParse({ version: 1, proposals });
    expect(envelope.success).toBe(false);
  });

  it("still rejects duplicate ids within one envelope when a project-meta proposal is involved", () => {
    const proposal = {
      id: "same-id",
      kind: "project-meta",
      title: "Set building type",
      reason: "The user described this project as an office build.",
      data: { building_type: "office" },
    };
    const envelope = projectCopilotEnvelopeSchema.safeParse({
      version: 1,
      proposals: [proposal, proposal],
    });
    expect(envelope.success).toBe(false);
  });
});

/**
 * These guard the data-loss regression described in lib/zodPatch.ts. Under Zod 4,
 * `schema.partial()` leaves each field's `.default()` live, so a three-key
 * project-details proposal parsed back as all eleven keys with the unsent ones
 * as `""`/`[]`/`null` -- and the confirm path spreads the patch over the stored
 * record, so every unmentioned field was cleared. Asserting on the parsed *key
 * set* rather than the values is the point: a patch must carry only what was
 * sent, so callers can still distinguish "omitted" from "deliberately emptied".
 */
describe("patch proposals carry only the keys that were submitted", () => {
  it("keeps a partial project-details payload partial", () => {
    const result = projectCopilotProposalSchema.safeParse({
      id: "details-partial",
      kind: "project-details",
      title: "Set the office address",
      reason: "Confirmed from the marketing plan.",
      data: { address: "100 Example St, Chicago, IL" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data.data)).toEqual(["address"]);
  });

  it("does not blank a stored record's other fields when the patch is spread over it", () => {
    const stored = {
      client_name: "STUDIO",
      address: "STUDIO",
      scope: "Other",
      project_type: "Marketing",
    };
    const patch = projectDetailsPatchSchema.parse({ address: "100 Example St, Chicago, IL" });
    const merged = { ...stored, ...patch };

    expect(merged).toEqual({
      client_name: "STUDIO",
      address: "100 Example St, Chicago, IL",
      scope: "Other",
      project_type: "Marketing",
    });
  });

  it("keeps an explicitly emptied field distinguishable from an omitted one", () => {
    expect(projectDetailsPatchSchema.parse({ client_name: "" })).toEqual({ client_name: "" });
    expect(projectDetailsPatchSchema.parse({ address: "x" }).client_name).toBeUndefined();
  });

  it("still requires a project-details patch to contain something", () => {
    expect(projectDetailsPatchSchema.safeParse({}).success).toBe(false);
  });

  it("keeps a one-field project-meta patch from clearing the other field", () => {
    const buildingOnly = projectMetaPatchSchema.parse({ building_type: "office" });
    expect(Object.keys(buildingOnly)).toEqual(["building_type"]);

    const occupancyOnly = projectMetaPatchSchema.parse({ occupancy_group: ["B"] });
    expect(Object.keys(occupancyOnly)).toEqual(["occupancy_group"]);

    const storedMeta = { building_type: "retail", occupancy_group: ["M", "S-1"] };
    expect({ ...storedMeta, ...buildingOnly }).toEqual({
      building_type: "office",
      occupancy_group: ["M", "S-1"],
    });
  });

  /**
   * A bare "10:00" is the natural reading of a field documented only as
   * `start_time`, and it cost a whole 18-proposal submission a failed round trip
   * against an error that just said "Invalid ISO datetime". The message has to
   * name the shape it wants.
   */
  it("tells a schedule-item author what a valid start_time looks like", () => {
    const result = projectCopilotProposalSchema.safeParse({
      id: "sched-bad-time",
      kind: "schedule-item",
      title: "SBIF rollout webinar",
      reason: "External date driving the campaign week.",
      data: {
        name: "SBIF rollout webinar",
        date: "2026-09-02",
        type: "Work Session",
        start_time: "13:00",
      },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.issues.map((issue) => issue.message).join(" | ");
    expect(message).toContain("2026-09-02T13:00:00-05:00");
    expect(message).toContain("UTC offset");
  });

  it("accepts a full ISO datetime with an offset", () => {
    const result = projectCopilotProposalSchema.safeParse({
      id: "sched-good-time",
      kind: "schedule-item",
      title: "SBIF rollout webinar",
      reason: "External date driving the campaign week.",
      data: {
        name: "SBIF rollout webinar",
        date: "2026-09-02",
        type: "Work Session",
        start_time: "2026-09-02T13:00:00-05:00",
        end_time: "2026-09-02T14:00:00-05:00",
      },
    });
    expect(result.success).toBe(true);
  });

  it("keeps .strict() smuggling protection after the patch-shape change", () => {
    const smuggled = projectMetaPatchSchema.safeParse({
      building_type: "office",
      notion_page_id: "smuggled",
    });
    expect(smuggled.success).toBe(false);
  });
});
