import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  mirror: vi.fn(() => ({ mirrored: false, reason: "not-linked" })),
  audit: vi.fn(),
}));

vi.mock("@/lib/content", () => ({
  createProjectDecision: mocks.create,
  getProjectSlugs: vi.fn(() => ["demo"]),
  mirrorProjectKnowledge: mocks.mirror,
}));
vi.mock("@/src/audit/log", () => ({ recordAudit: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "./route";

const decision = {
  version: 1,
  id: "decision-12345678",
  title: "Select storefront system",
  status: "proposed",
  decision_date: "2026-07-28",
  recorded_at: "2026-07-28T18:00:00.000Z",
  confirmed_by: null,
  deciders: ["Owner"],
  context: "A selection is needed.",
  options: [],
  outcome: "",
  rationale: "",
  consequences: [],
  affected_deliverables: [],
  sources: [{ kind: "conversation", label: "Human-entered in Mi" }],
  supersedes: null,
  superseded_by: null,
};

describe("decision create route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockImplementation((_slug, value) => ({
      decision: value,
      fileName: "2026-07-28-decision-12345678.md",
      relativePath: "decisions/2026-07-28-decision-12345678.md",
      hash: "hash",
    }));
  });

  it("returns a side-effect-free validated preview", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects/demo/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: false, decision }),
      }),
      { params: Promise.resolve({ slug: "demo" }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).saved).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.mirror).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("writes only after explicit confirmation and audits bounded metadata", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects/demo/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, decision }),
      }),
      { params: Promise.resolve({ slug: "demo" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      "demo",
      expect.objectContaining({ id: decision.id, recorded_at: expect.any(String) }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      diff: expect.objectContaining({ id: decision.id, source_count: 1 }),
    }));
  });
});
