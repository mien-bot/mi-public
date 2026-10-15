import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  mirror: vi.fn(() => ({ mirrored: false, reason: "not-linked" })),
  audit: vi.fn(),
}));

vi.mock("@/lib/content", () => ({
  createProjectSiteReport: mocks.create,
  getProjectSlugs: vi.fn(() => ["demo"]),
  mirrorProjectKnowledge: mocks.mirror,
}));
vi.mock("@/src/audit/log", () => ({ recordAudit: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "./route";

const report = {
  version: 1,
  id: "site-report-12345678",
  title: "Existing conditions walk",
  status: "draft",
  origin: "manual",
  visit_date: "2026-07-28",
  created_at: "2026-07-28T18:00:00.000Z",
  updated_at: null,
  confirmed_by: null,
  purpose: "Observe visible conditions.",
  scope: "Lobby only.",
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
};

describe("site-report create route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockImplementation((_slug, value) => ({
      report: value,
      fileName: "2026-07-28-site-report-12345678.md",
      relativePath: "site-reports/2026-07-28-site-report-12345678.md",
      hash: "hash",
    }));
  });

  it("previews without touching local or Dropbox storage", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects/demo/site-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: false, report }),
      }),
      { params: Promise.resolve({ slug: "demo" }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).saved).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.mirror).not.toHaveBeenCalled();
  });

  it("saves a confirmed draft and audits counts without report prose", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects/demo/site-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, report }),
      }),
      { params: Promise.resolve({ slug: "demo" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({ id: report.id, created_at: expect.any(String) }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      diff: {
        id: report.id,
        status: "draft",
        visit_date: "2026-07-28",
        item_count: 1,
        photo_reference_count: 0,
      },
    }));
  });
});
