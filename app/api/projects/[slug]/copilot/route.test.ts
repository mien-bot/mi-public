import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isWriteAllowed: vi.fn(() => false),
  getStudioProjectPage: vi.fn(),
  createProjectScheduleEntry: vi.fn(),
  writeProjectWorklog: vi.fn(),
  appendProjectMemoryNote: vi.fn(() => "/projects/demo/memory/notes.md"),
  appendDropboxProjectMemoryNote: vi.fn(() => "E:\\Dropbox\\STUDIO\\Demo\\Mi\\memory\\notes.md"),
  previewDropboxProjectMemory: vi.fn(() => ({
    available: true as boolean,
    destination: "E:\\Dropbox\\STUDIO\\Demo\\Mi\\memory\\notes.md" as string | undefined,
    currentHash: "memory-hash" as string | null | undefined,
    reason: undefined as string | undefined,
  })),
  createProjectDecision: vi.fn((slug, decision) => ({
    decision,
    fileName: `${decision.decision_date}-${decision.id}.md`,
    relativePath: `decisions/${decision.decision_date}-${decision.id}.md`,
    hash: "decision-hash",
  })),
  createProjectSiteReport: vi.fn((slug, report) => ({
    report,
    fileName: `${report.visit_date}-${report.id}.md`,
    relativePath: `site-reports/${report.visit_date}-${report.id}.md`,
    hash: "report-hash",
  })),
  mirrorProjectKnowledge: vi.fn(() => ({ mirrored: false, reason: "not-linked" })),
  writeProjectMeta: vi.fn(),
  getProjectDetailsWithHash: vi.fn(),
  writeProjectDetails: vi.fn(),
}));

vi.mock("@/lib/content", () => ({
  appendProjectMemoryNote: mocks.appendProjectMemoryNote,
  appendDropboxProjectMemoryNote: mocks.appendDropboxProjectMemoryNote,
  createProjectDecision: mocks.createProjectDecision,
  createProjectSiteReport: mocks.createProjectSiteReport,
  getMeetingNotes: vi.fn(() => []),
  getProjectWithHash: vi.fn(() => ({
    hash: "project-meta-hash",
    project: {
      slug: "demo",
      meta: {
        name: "Demo Project",
        address: "123 Main St",
        client: "Demo Client",
        status: "in-progress",
        building_type: null,
        occupancy_group: [],
        notion_page_id: "confirmed-project-page-id",
      },
    },
  })),
  getProjectDetailsWithHash: mocks.getProjectDetailsWithHash,
  getProjectSlugs: vi.fn(() => ["demo"]),
  getSchedule: vi.fn(),
  previewDropboxProjectMemory: mocks.previewDropboxProjectMemory,
  mirrorProjectKnowledge: mocks.mirrorProjectKnowledge,
  schedulePath: vi.fn(),
  writeMeetingNote: vi.fn(),
  writeProjectDetails: mocks.writeProjectDetails,
  writeProjectMeta: mocks.writeProjectMeta,
  writeProjectSchedule: vi.fn(),
  writeReviewFinding: vi.fn(),
}));

vi.mock("@/lib/content/atomicContentWrite", () => ({
  readCurrentHash: vi.fn(),
}));

vi.mock("@/lib/content/projectWorklog", () => ({
  getProjectWorklog: vi.fn(() => []),
  getProjectWorklogWithHash: vi.fn(() => ({ entries: [], hash: null })),
  projectWorklogPath: vi.fn(() => "/projects/demo/schedule/worklog.yaml"),
  summarizeProjectWorklog: vi.fn(() => ({ companyHours: 0, entryCount: 0 })),
  writeProjectWorklog: mocks.writeProjectWorklog,
}));

vi.mock("@/lib/content/notionScheduleSync", () => ({
  saveScheduleItemLocally: vi.fn(),
  syncScheduleItems: vi.fn(),
}));

vi.mock("@/lib/content/worklogSync", () => ({
  syncWorklogEntry: vi.fn(),
}));

vi.mock("@/lib/notion/people", () => ({
  resolveNotionPeopleByName: vi.fn(),
}));

vi.mock("@/src/adapters/notion/schedule", () => ({
  createProjectScheduleEntry: mocks.createProjectScheduleEntry,
}));

vi.mock("@/src/adapters/notion/studioProjects", () => ({
  getStudioProjectPage: mocks.getStudioProjectPage,
}));

vi.mock("@/src/audit/log", () => ({
  recordAudit: vi.fn(),
}));

vi.mock("@/src/policies/approvals", () => ({
  isWriteAllowed: mocks.isWriteAllowed,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ slug: "demo" }) };

describe("copilot Notion policy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isWriteAllowed.mockReturnValue(false);
    mocks.previewDropboxProjectMemory.mockReturnValue({
      available: true,
      destination: "E:\\Dropbox\\STUDIO\\Demo\\Mi\\memory\\notes.md",
      currentHash: "memory-hash",
      reason: undefined,
    });
  });

  it("blocks a confirmed time entry when schedule creation is disabled", async () => {
    const request = new Request("http://localhost/api/projects/demo/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        destination: "notion",
        proposal: {
          id: "hours-policy-check",
          title: "Drawing coordination",
          reason: "Record confirmed project time.",
          kind: "time-entry",
          data: {
            name: "Drawing coordination",
            date: "2026-07-28",
            hours: 2.5,
            attendees: ["Example User"],
            notes: "Reviewed the reflected ceiling plan.",
          },
        },
      }),
    });

    const response = await POST(request, context);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Notion time-entry creation is disabled in mi.config.yaml.",
    });
    expect(mocks.isWriteAllowed).toHaveBeenCalledWith("schedule", "create");
    expect(mocks.getStudioProjectPage).not.toHaveBeenCalled();
    expect(mocks.createProjectScheduleEntry).not.toHaveBeenCalled();
    expect(mocks.writeProjectWorklog).not.toHaveBeenCalled();
  });

  it("mirrors a confirmed memory proposal only after the Dropbox destination is selected", async () => {
    const proposal = {
      id: "remember-client-decision",
      title: "Client decision",
      reason: "Preserve a confirmed durable decision.",
      kind: "memory-note",
      data: { entry: "The client approved the north elevation option." },
    };
    const request = new Request("http://localhost/api/projects/demo/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        destination: "dropbox",
        proposal,
      }),
    });

    const response = await POST(request, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.previewDropboxProjectMemory).toHaveBeenCalledWith("demo");
    expect(mocks.appendProjectMemoryNote).toHaveBeenCalledWith("demo", {
      title: "Client decision",
      entry: "The client approved the north elevation option.",
    });
    expect(mocks.appendDropboxProjectMemoryNote).toHaveBeenCalledWith(
      "demo",
      {
        title: "Client decision",
        entry: "The client approved the north elevation option.",
      },
      "memory-hash",
    );
    expect(body.result).toMatchObject({
      destination: "Mi project memory + Dropbox",
      mirror: { status: "success", fileCount: 1 },
    });
  });

  it("fails before saving memory when the confirmed Dropbox destination is unavailable", async () => {
    mocks.previewDropboxProjectMemory.mockReturnValue({
      available: false,
      reason: "not-linked",
      destination: undefined,
      currentHash: undefined,
    });
    const request = new Request("http://localhost/api/projects/demo/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        destination: "dropbox",
        proposal: {
          id: "remember-unlinked",
          title: "Unlinked memory",
          reason: "Test the confirmation boundary.",
          kind: "memory-note",
          data: { entry: "Do not save this without the confirmed folder." },
        },
      }),
    });

    const response = await POST(request, context);

    expect(response.status).toBe(409);
    expect(mocks.appendProjectMemoryNote).not.toHaveBeenCalled();
    expect(mocks.appendDropboxProjectMemoryNote).not.toHaveBeenCalled();
  });

  it("stamps and saves an AI decision only as a proposal", async () => {
    const request = new Request("http://localhost/api/projects/demo/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        proposal: {
          id: "record-lobby-direction",
          title: "Record lobby direction",
          reason: "Preserve it for review.",
          kind: "decision-record",
          data: {
            version: 1,
            id: "decision-lobby-direction",
            title: "Lobby direction",
            status: "proposed",
            decision_date: "2026-07-28",
            confirmed_by: null,
            deciders: ["Owner"],
            context: "Discussed in the owner meeting.",
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
      }),
    });

    const response = await POST(request, context);
    expect(response.status).toBe(200);
    expect(mocks.createProjectDecision).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        id: "decision-lobby-direction",
        status: "proposed",
        recorded_at: expect.any(String),
      }),
    );
    expect(mocks.mirrorProjectKnowledge).toHaveBeenCalledWith("demo");
  });

  it("stamps and saves an AI site report as an unreviewed draft", async () => {
    const request = new Request("http://localhost/api/projects/demo/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        proposal: {
          id: "draft-site-walk",
          title: "Draft site walk",
          reason: "Categorize the supplied notes.",
          kind: "site-report",
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
      }),
    });

    const response = await POST(request, context);
    expect(response.status).toBe(200);
    expect(mocks.createProjectSiteReport).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({
        id: "site-report-site-walk",
        status: "draft",
        confirmed_by: null,
        created_at: expect.any(String),
      }),
    );
  });
});

describe("project-meta proposal (guided interview's building & occupancy step)", () => {
  const validProjectMetaProposal = {
    id: "meta-1",
    kind: "project-meta",
    title: "Set building type and occupancy",
    reason: "The user described a mixed-use build with retail and multifamily units.",
    data: { building_type: "mixed-use", occupancy_group: ["R-2", "B"] },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a preview and touches no file when confirmed is absent", async () => {
    const request = new Request("http://localhost/api/projects/demo/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal: validProjectMetaProposal }),
    });
    const response = await POST(request, context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.confirmed).toBe(false);
    expect(body.preview).toMatchObject({ kind: "project-meta" });
    expect(mocks.writeProjectMeta).not.toHaveBeenCalled();
  });

  it("merges a confirmed project-meta proposal onto the current project.yaml and writes it", async () => {
    const request = new Request("http://localhost/api/projects/demo/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal: validProjectMetaProposal, confirmed: true }),
    });
    const response = await POST(request, context);
    expect(response.status).toBe(200);

    expect(mocks.writeProjectMeta).toHaveBeenCalledTimes(1);
    const [writtenSlug, writtenMeta, writeOptions] = mocks.writeProjectMeta.mock.calls[0];
    expect(writtenSlug).toBe("demo");
    // Merged onto the existing meta -- untouched fields (name/address/client/status) survive.
    expect(writtenMeta).toMatchObject({
      name: "Demo Project",
      address: "123 Main St",
      client: "Demo Client",
      status: "in-progress",
      building_type: "mixed-use",
      occupancy_group: ["R-2", "B"],
    });
    expect(writeOptions).toEqual({ expectedHash: "project-meta-hash" });
  });

  /**
   * The server re-validates the proposal itself (not just the confirm flag) --
   * a crafted proposal smuggling a `status` key into project-meta data must be
   * rejected by projectMetaPatchSchema's .strict() before writeProjectMeta (and
   * therefore any file write) is ever reached.
   */
  it("rejects a crafted project-meta proposal smuggling a status key before any write happens", async () => {
    const craftedProposal = {
      id: "meta-2",
      kind: "project-meta",
      title: "Sneaky",
      reason: "attempted smuggling",
      data: { building_type: "office", status: "complete" },
    };
    const request = new Request("http://localhost/api/projects/demo/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal: craftedProposal, confirmed: true }),
    });
    const response = await POST(request, context);
    expect(response.status).toBe(400);
    expect(mocks.writeProjectMeta).not.toHaveBeenCalled();
  });
});

/**
 * The acceptance test for the data-loss regression: a three-key project-details
 * proposal, confirmed against a fully populated record, once wrote empty strings
 * over client_name/scope/project_type because Zod 4's `.partial()` materialized
 * every absent key as its default. See lib/zodPatch.ts.
 */
describe("confirming a partial project-details proposal", () => {
  const stored = {
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

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProjectDetailsWithHash.mockReturnValue({ details: stored, hash: "details-hash" });
  });

  it("writes the submitted field and leaves every other field exactly as stored", async () => {
    const request = new Request("http://localhost/api/projects/demo/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        proposal: {
          id: "details-address-only",
          kind: "project-details",
          title: "Set the office address",
          reason: "Confirmed from the marketing plan.",
          data: { address: "100 Example St, Chicago, IL" },
        },
      }),
    });

    const response = await POST(request, context);
    expect(response.status).toBe(200);
    expect(mocks.writeProjectDetails).toHaveBeenCalledTimes(1);

    const written = mocks.writeProjectDetails.mock.calls[0][1];
    expect(written).toEqual({ ...stored, address: "100 Example St, Chicago, IL" });
  });

  it("still lets a proposal deliberately clear a field it names", async () => {
    const request = new Request("http://localhost/api/projects/demo/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        proposal: {
          id: "details-clear-scope",
          kind: "project-details",
          title: "Clear the scope",
          reason: "The recorded scope turned out to be wrong.",
          data: { scope: "" },
        },
      }),
    });

    const response = await POST(request, context);
    expect(response.status).toBe(200);

    const written = mocks.writeProjectDetails.mock.calls[0][1];
    expect(written).toEqual({ ...stored, scope: "" });
  });
});
