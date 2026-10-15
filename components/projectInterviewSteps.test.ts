import { describe, expect, it } from "vitest";
import { computeInterviewSteps, parseInterviewNavigation } from "./projectInterviewSteps";
import type { ProjectDetails, ProjectMeta, Schedule } from "@/lib/schema";

function emptyDetails(): ProjectDetails {
  return {
    client_name: "",
    client_contacts: [],
    address: "",
    scope: "",
    project_type: "",
    team: [],
    fee: null,
    fee_currency: "USD",
    fee_notes: "",
    contract_link_or_path: "",
  };
}

function filledDetails(): ProjectDetails {
  return {
    client_name: "Acme LLC",
    client_contacts: [{ name: "Jane Doe", role: "Owner", email: "user@example.com", phone: "" }],
    address: "123 Main St",
    scope: "New restaurant build-out",
    project_type: "Restaurant",
    team: [{ name: "Example User", role: "Architect" }],
    fee: 50_000,
    fee_currency: "USD",
    fee_notes: "",
    contract_link_or_path: "",
  };
}

function emptyMeta(): ProjectMeta {
  return {
    name: "Demo Project",
    address: "",
    client: "",
    status: "in-progress",
    building_type: null,
    occupancy_group: [],
    start_date: null,
    team: [],
    dropbox_path: null,
    content_location: "local",
    content_migrated_at: null,
    notion_page_id: null,
    client_id: null,
  };
}

function filledMeta(): ProjectMeta {
  return {
    ...emptyMeta(),
    building_type: "restaurant-hospitality",
    occupancy_group: ["A-2"],
  };
}

function emptySchedule(): Schedule {
  return { milestones: [] };
}

function milestone(id: string, name: string): Schedule["milestones"][number] {
  return { id, name, planned_date: "2026-01-01", actual_date: null, notion_event_id: null, sync_key: null };
}

function fullyCoveredSchedule(): Schedule {
  return {
    milestones: [
      milestone("m1", "Kick-off meeting"),
      milestone("m2", "Schematic Design submission"),
      milestone("m3", "Design Development review"),
      milestone("m4", "Construction Documents issued"),
      milestone("m5", "Permit submission"),
      milestone("m6", "Construction Administration begins"),
    ],
  };
}

function findStep(steps: ReturnType<typeof computeInterviewSteps>, id: string) {
  const step = steps.find((s) => s.id === id);
  if (!step) throw new Error(`Expected a "${id}" step in the computed list.`);
  return step;
}

describe("computeInterviewSteps", () => {
  it("returns all seven steps in wizard order", () => {
    const steps = computeInterviewSteps(emptyDetails(), emptyMeta(), emptySchedule());
    expect(steps.map((s) => s.id)).toEqual([
      "client-contacts",
      "address-scope",
      "building-meta",
      "team-fee",
      "schedule",
      "constraints-deliverables",
      "review",
    ]);
  });

  it("marks every skippable step needed for a fully empty project", () => {
    const steps = computeInterviewSteps(emptyDetails(), emptyMeta(), emptySchedule());
    for (const id of ["client-contacts", "address-scope", "building-meta", "team-fee", "schedule"]) {
      const step = findStep(steps, id);
      expect(step.needed).toBe(true);
      expect(step.skipReason).toBeNull();
    }
    // Always-offered steps stay needed regardless of fill state.
    expect(findStep(steps, "constraints-deliverables").needed).toBe(true);
    expect(findStep(steps, "review").needed).toBe(true);
  });

  /**
   * "Fully filled" skips every step that *can* mechanically skip. Per the
   * assignment's explicit step-1 spec, "constraints-deliverables" has no
   * persisted schema field backing it and must never mechanically skip --
   * it and "review" are the two steps that always stay needed, even here.
   */
  it("skips every mechanically-skippable step for a fully filled project, leaving only constraints-deliverables and review needed", () => {
    const steps = computeInterviewSteps(filledDetails(), filledMeta(), fullyCoveredSchedule());
    for (const id of ["client-contacts", "address-scope", "building-meta", "team-fee", "schedule"]) {
      const step = findStep(steps, id);
      expect(step.needed).toBe(false);
      expect(step.skipReason).toEqual(expect.any(String));
    }
    expect(findStep(steps, "constraints-deliverables").needed).toBe(true);
    expect(findStep(steps, "review").needed).toBe(true);
  });

  it("computes a mixed/partially-filled project independently per field group", () => {
    const details: ProjectDetails = {
      ...emptyDetails(),
      client_name: "Acme LLC", // client_contacts still empty -> client-contacts stays needed
      address: "123 Main St",
      scope: "New restaurant build-out",
      // project_type left blank -> address-scope stays needed
      team: [{ name: "Example User", role: "Architect" }],
      // fee left null -> team-fee stays needed
    };
    const meta: ProjectMeta = {
      ...emptyMeta(),
      building_type: "restaurant-hospitality",
      // occupancy_group left empty -> building-meta stays needed
    };
    const schedule: Schedule = {
      milestones: [milestone("m1", "Kick-off meeting"), milestone("m2", "Schematic Design submission")],
    };

    const steps = computeInterviewSteps(details, meta, schedule);
    expect(findStep(steps, "client-contacts").needed).toBe(true);
    expect(findStep(steps, "address-scope").needed).toBe(true);
    expect(findStep(steps, "building-meta").needed).toBe(true);
    expect(findStep(steps, "team-fee").needed).toBe(true);
    const scheduleStep = findStep(steps, "schedule");
    expect(scheduleStep.needed).toBe(true); // DD/CD/permit/CA still unmatched
    expect(scheduleStep.matchedMilestones).toEqual([
      { topic: "kick-off", topicLabel: "Kick-off", milestoneName: "Kick-off meeting" },
      { topic: "sd", topicLabel: "Schematic Design", milestoneName: "Schematic Design submission" },
    ]);
  });

  it("skips address-scope only once address, scope, and project_type are all non-blank", () => {
    const almostThere = computeInterviewSteps(
      { ...emptyDetails(), address: "123 Main St", scope: "Renovation" },
      emptyMeta(),
      emptySchedule(),
    );
    expect(findStep(almostThere, "address-scope").needed).toBe(true);

    const complete = computeInterviewSteps(
      { ...emptyDetails(), address: "123 Main St", scope: "Renovation", project_type: "Retail" },
      emptyMeta(),
      emptySchedule(),
    );
    expect(findStep(complete, "address-scope").needed).toBe(false);
  });

  describe("schedule heuristic matching", () => {
    it("matches an exact keyword substring case-insensitively", () => {
      const steps = computeInterviewSteps(emptyDetails(), emptyMeta(), {
        milestones: [milestone("m1", "PERMIT Submission")],
      });
      const scheduleStep = findStep(steps, "schedule");
      expect(scheduleStep.matchedMilestones).toEqual([
        { topic: "permit", topicLabel: "Permit", milestoneName: "PERMIT Submission" },
      ]);
    });

    it("matches near-miss casing/whitespace variants of a keyword", () => {
      const steps = computeInterviewSteps(emptyDetails(), emptyMeta(), {
        milestones: [milestone("m1", "  kick off  Meeting"), milestone("m2", "DESIGN DEVELOPMENT deliverable")],
      });
      const scheduleStep = findStep(steps, "schedule");
      expect(scheduleStep.matchedMilestones).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ topic: "kick-off", milestoneName: "  kick off  Meeting" }),
          expect.objectContaining({ topic: "dd", milestoneName: "DESIGN DEVELOPMENT deliverable" }),
        ]),
      );
    });

    it("returns an empty matched list and stays needed when nothing matches any keyword", () => {
      const steps = computeInterviewSteps(emptyDetails(), emptyMeta(), {
        milestones: [milestone("m1", "Site visit"), milestone("m2", "Client check-in")],
      });
      const scheduleStep = findStep(steps, "schedule");
      expect(scheduleStep.matchedMilestones).toEqual([]);
      expect(scheduleStep.needed).toBe(true);
    });

    it("never silently trusts the match -- always returns the matched list alongside the verdict, not just a boolean", () => {
      const steps = computeInterviewSteps(emptyDetails(), emptyMeta(), fullyCoveredSchedule());
      const scheduleStep = findStep(steps, "schedule");
      expect(scheduleStep.needed).toBe(false);
      expect(Array.isArray(scheduleStep.matchedMilestones)).toBe(true);
      expect(scheduleStep.matchedMilestones!.length).toBeGreaterThan(0);
    });
  });
});

describe("typing navigation into the interview box", () => {
  it("treats a bare move-on request as navigation", () => {
    for (const message of [
      "next",
      "Next",
      "next step",
      "skip",
      "skip this",
      "Skip this step.",
      "continue",
      "move on",
      "ok next",
      "please skip this",
      "no skip this",
    ]) {
      expect(parseInterviewNavigation(message)).toBe("next");
    }
  });

  it("recognizes going backwards", () => {
    for (const message of ["back", "go back", "previous", "previous step"]) {
      expect(parseInterviewNavigation(message)).toBe("back");
    }
  });

  it("never swallows a message that carries a real answer", () => {
    for (const message of [
      "skip the fee, the client is example-record-37",
      "next Friday",
      "move the kick-off to next week",
      "back of house renovation",
      "the client contact is next door",
      "Taylor",
      "",
    ]) {
      expect(parseInterviewNavigation(message)).toBeNull();
    }
  });
});
