import { describe, expect, it } from "vitest";
import { diffRows, fieldValueText, patchDiffRow, proposalSummary } from "./proposalDiff";
import type { ProjectCopilotProposal } from "@/lib/projectCopilot";
import type { ProjectDetails } from "@/lib/schema";

const storedDetails: ProjectDetails = {
  client_name: "STUDIO",
  client_contacts: [],
  address: "STUDIO",
  scope: "Other",
  project_type: "Marketing",
  team: [],
  fee: null,
  fee_currency: "USD",
  fee_notes: "",
  contract_link_or_path: "",
  phases: [],
};

describe("fieldValueText", () => {
  it("collapses every flavour of empty to the same blank string", () => {
    expect(fieldValueText("")).toBe("");
    expect(fieldValueText(null)).toBe("");
    expect(fieldValueText(undefined)).toBe("");
    expect(fieldValueText([])).toBe("");
  });

  it("renders object arrays readably rather than as JSON", () => {
    expect(fieldValueText([{ name: "Example User", role: "Strategy" }, { name: "Example Colleague", role: "Production" }]))
      .toBe("Example User — Strategy; Example Colleague — Production");
  });
});

describe("patchDiffRow", () => {
  it("flags a field going from a real value to nothing", () => {
    const row = patchDiffRow("client_name", "STUDIO", "");
    expect(row).toMatchObject({ label: "client name", from: "STUDIO", to: "" });
    expect(row.badge).toEqual({ text: "Clears this field", tone: "danger" });
  });

  it("does not flag a field that was already empty", () => {
    expect(patchDiffRow("fee_notes", "", "").badge).toEqual({ text: "Unchanged", tone: "muted" });
  });

  it("does not flag an ordinary change", () => {
    expect(patchDiffRow("address", "STUDIO", "100 Example St").badge).toBeUndefined();
  });

  it("treats emptying a populated list as a clear", () => {
    expect(patchDiffRow("team", [{ name: "Example User", role: "Strategy" }], []).badge)
      .toEqual({ text: "Clears this field", tone: "danger" });
  });
});

describe("diffRows for a project-details proposal", () => {
  const proposal = (data: Record<string, unknown>) => ({
    id: "details-1",
    kind: "project-details",
    title: "Update details",
    reason: "Confirmed from the marketing plan.",
    data,
  }) as unknown as ProjectCopilotProposal;

  it("shows the stored value as the before side", () => {
    const rows = diffRows(proposal({ address: "100 Example St, Chicago, IL" }), { details: storedDetails });
    expect(rows).toEqual([
      { label: "address", from: "STUDIO", to: "100 Example St, Chicago, IL", badge: undefined },
    ]);
  });

  /**
   * The regression this whole surface exists for: the apply that blanked
   * client_name/scope/project_type would now be three loud "Clears this field"
   * rows on the card before anyone confirms it.
   */
  it("marks every field the payload would blank", () => {
    const rows = diffRows(
      proposal({ client_name: "", scope: "", project_type: "", address: "100 Example St, Chicago, IL" }),
      { details: storedDetails },
    );
    const cleared = rows.filter((row) => row.badge?.tone === "danger").map((row) => row.label);
    expect(cleared).toEqual(["client name", "scope", "project type"]);
  });

  it("falls back to a plain to-value when no stored record is in scope", () => {
    const rows = diffRows(proposal({ address: "100 Example St" }), {});
    expect(rows).toEqual([{ label: "address", from: "", to: "100 Example St", badge: undefined }]);
  });
});

describe("diffRows for a project-meta proposal", () => {
  it("does not report an untouched field as cleared", () => {
    const rows = diffRows(
      {
        id: "meta-1",
        kind: "project-meta",
        title: "Set building type",
        reason: "Confirmed as an office build.",
        data: { building_type: "office" },
      } as unknown as ProjectCopilotProposal,
      { meta: { building_type: null, occupancy_group: ["B"] } },
    );

    expect(rows).toEqual([{ label: "building type", from: "", to: "office", badge: undefined }]);
  });
});

describe("diffRows for a meeting plan", () => {
  const proposal = {
    id: "meeting-plan",
    kind: "meeting-note",
    title: "Plan the client meeting",
    reason: "The user requested an agenda.",
    data: {
      id: "client-meeting",
      title: "Client meeting",
      meeting_type: "Client Meeting",
      meeting_status: "planned",
      date: "2026-08-12",
      start_time: "10:00",
      end_time: "11:00",
      timezone: "America/Chicago",
      attendees: [],
      objective: "Review the contract.",
      preparation: ["Read the contract."],
      agenda_items: [
        { topic: "Contract", duration_minutes: 20, desired_outcome: "Confirm scope." },
        { topic: "Next steps", duration_minutes: 40, desired_outcome: "Assign actions." },
      ],
      raw_notes: "",
      summary: "",
      decisions: [],
      action_items: [],
      open_questions: [],
      decision_records: [],
      blocking_questions: [],
      impacts: [],
      sources: [],
    },
  } as const satisfies ProjectCopilotProposal;

  it("shows the objective, preparation, and timeboxes before confirmation", () => {
    const rows = diffRows(proposal, {});
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "State", to: "Planned agenda" }),
      expect.objectContaining({ label: "Objective", to: "Review the contract." }),
      expect.objectContaining({ label: "Preparation", to: "Read the contract." }),
      expect.objectContaining({ label: "Agenda", to: expect.stringContaining("20 min — Contract") }),
    ]));
    expect(proposalSummary(proposal)).toContain("1h agenda");
  });
});
