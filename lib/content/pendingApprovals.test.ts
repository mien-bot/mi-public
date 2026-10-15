import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAgentProposalInbox: vi.fn(() => [] as { pendingProposals: unknown[] }[]),
  getProjectDecisions: vi.fn(() => [] as { decision: { status: string } }[]),
  getProjectSiteReports: vi.fn(() => [] as { report: { status: string; origin: string } }[]),
  getProject: vi.fn((slug: string) => ({ slug, meta: { name: `Name of ${slug}` } })),
  getProjectSlugs: vi.fn(() => ["demo"]),
}));

vi.mock("./agentProposalInbox", () => ({ listAgentProposalInbox: mocks.listAgentProposalInbox }));
vi.mock("./projectDecisions", () => ({ getProjectDecisions: mocks.getProjectDecisions }));
vi.mock("./projectSiteReports", () => ({ getProjectSiteReports: mocks.getProjectSiteReports }));
vi.mock("./projects", () => ({
  getProject: mocks.getProject,
  getProjectSlugs: mocks.getProjectSlugs,
}));

import { getProjectPendingApprovals, listPendingApprovals } from "./pendingApprovals";

/**
 * clearAllMocks only clears call history -- a mockReturnValue set by one test
 * would otherwise still be in force for the next one.
 */
function resetMocks() {
  vi.clearAllMocks();
  mocks.listAgentProposalInbox.mockReturnValue([]);
  mocks.getProjectDecisions.mockReturnValue([]);
  mocks.getProjectSiteReports.mockReturnValue([]);
  mocks.getProjectSlugs.mockReturnValue(["demo"]);
  mocks.getProject.mockImplementation((slug: string) => ({ slug, meta: { name: `Name of ${slug}` } }));
}

describe("getProjectPendingApprovals", () => {
  beforeEach(resetMocks);

  it("reports nothing when no AI output is waiting", () => {
    expect(getProjectPendingApprovals("demo")).toMatchObject({ total: 0, groups: [] });
  });

  it("counts pending proposals across every envelope in the inbox", () => {
    mocks.listAgentProposalInbox.mockReturnValue([
      { pendingProposals: [{}, {}, {}] },
      { pendingProposals: [{}] },
      { pendingProposals: [] },
    ]);

    const approvals = getProjectPendingApprovals("demo");
    expect(approvals.total).toBe(4);
    expect(approvals.groups[0]).toMatchObject({
      kind: "agent-proposal",
      count: 4,
      href: "/projects/demo#project-agent-proposal-inbox",
    });
  });

  it("counts decisions the AI proposed but nobody confirmed", () => {
    mocks.getProjectDecisions.mockReturnValue([
      { decision: { status: "proposed" } },
      { decision: { status: "decided" } },
      { decision: { status: "proposed" } },
    ]);

    expect(getProjectPendingApprovals("demo").groups).toEqual([
      expect.objectContaining({ kind: "decision-record", count: 2 }),
    ]);
  });

  /**
   * A person's own unfinished draft is not an AI write awaiting review, and
   * counting it would train people to ignore the banner.
   */
  it("counts AI-drafted site reports but not hand-authored drafts", () => {
    mocks.getProjectSiteReports.mockReturnValue([
      { report: { status: "draft", origin: "ai-assisted" } },
      { report: { status: "draft", origin: "manual" } },
      { report: { status: "reviewed", origin: "ai-assisted" } },
    ]);

    expect(getProjectPendingApprovals("demo").groups).toEqual([
      expect.objectContaining({ kind: "site-report", count: 1 }),
    ]);
  });

  it("adds every source into one total", () => {
    mocks.listAgentProposalInbox.mockReturnValue([{ pendingProposals: [{}, {}] }]);
    mocks.getProjectDecisions.mockReturnValue([{ decision: { status: "proposed" } }]);
    mocks.getProjectSiteReports.mockReturnValue([{ report: { status: "draft", origin: "ai-assisted" } }]);

    const approvals = getProjectPendingApprovals("demo");
    expect(approvals.total).toBe(4);
    expect(approvals.groups.map((group) => group.kind)).toEqual([
      "agent-proposal",
      "decision-record",
      "site-report",
    ]);
  });
});

describe("listPendingApprovals", () => {
  beforeEach(resetMocks);

  it("keeps only projects with something waiting, busiest first", () => {
    mocks.getProjectSlugs.mockReturnValue(["quiet", "busy", "some"]);
    mocks.listAgentProposalInbox.mockImplementation((slug: string) => {
      if (slug === "busy") return [{ pendingProposals: [{}, {}, {}] }];
      if (slug === "some") return [{ pendingProposals: [{}] }];
      return [];
    });

    expect(listPendingApprovals().map((entry) => [entry.slug, entry.total])).toEqual([
      ["busy", 3],
      ["some", 1],
    ]);
  });

  it("skips a project whose content root is unreachable instead of failing the list", () => {
    mocks.getProjectSlugs.mockReturnValue(["offline", "fine"]);
    mocks.listAgentProposalInbox.mockImplementation((slug: string) => {
      if (slug === "offline") throw new Error("Dropbox is offline.");
      return [{ pendingProposals: [{}] }];
    });

    expect(listPendingApprovals().map((entry) => entry.slug)).toEqual(["fine"]);
  });
});
