import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateStatus: vi.fn(),
  patchScalarField: vi.fn(),
  mirrorProjectKnowledge: vi.fn(),
  isWriteAllowed: vi.fn(() => true),
  project: { slug: "demo", meta: { notion_page_id: "exact-project-id", status: "not-started" } },
}));

vi.mock("@/lib/content", () => ({
  getProjectSlugs: () => ["demo"],
  getProject: () => mocks.project,
  mirrorProjectKnowledge: mocks.mirrorProjectKnowledge,
}));

vi.mock("@/lib/content/paths", () => ({ REPO_ROOT: "/repo", PROJECTS_DIR: "/repo/projects" }));

vi.mock("@/src/adapters/notion/studioProjects", () => ({
  updateStudioProjectStatus: mocks.updateStatus,
}));

vi.mock("@/src/adapters/repo/patchYamlField", () => ({
  patchScalarField: mocks.patchScalarField,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/audit/log", () => ({ recordAudit: vi.fn() }));
vi.mock("@/src/policies/approvals", () => ({ isWriteAllowed: mocks.isWriteAllowed }));

import { PATCH } from "./route";

const context = { params: Promise.resolve({ slug: "demo" }) };

function request(body: unknown) {
  return new Request("http://localhost/api/projects/demo/status", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("status route confirmation contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isWriteAllowed.mockReturnValue(true);
    mocks.project.meta.notion_page_id = "exact-project-id";
    mocks.project.meta.status = "not-started";
  });

  it("rejects a status change without the explicit confirmation flag", async () => {
    const response = await PATCH(request({ status: "in-progress" }), context);
    expect(response.status).toBe(409);
    expect(mocks.updateStatus).not.toHaveBeenCalled();
    expect(mocks.patchScalarField).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value even when confirmed", async () => {
    const response = await PATCH(request({ status: "not-a-real-status", confirmed: true }), context);
    expect(response.status).toBe(400);
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it("refuses to write when the project has no linked Notion page", async () => {
    mocks.project.meta.notion_page_id = null as unknown as string;
    const response = await PATCH(request({ status: "in-progress", confirmed: true }), context);
    expect(response.status).toBe(409);
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it("refuses to write when mi.config.yaml disables project status writes", async () => {
    mocks.isWriteAllowed.mockReturnValue(false);
    const response = await PATCH(request({ status: "in-progress", confirmed: true }), context);
    expect(response.status).toBe(409);
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it("updates Notion then the local project.yaml after confirmation", async () => {
    const response = await PATCH(request({ status: "in-progress", confirmed: true }), context);
    expect(response.status).toBe(200);
    expect(mocks.updateStatus).toHaveBeenCalledWith("exact-project-id", "in-progress");
    expect(mocks.patchScalarField).toHaveBeenCalledWith(
      expect.stringContaining("demo"),
      "status",
      "in-progress",
    );
    expect(await response.json()).toMatchObject({ status: "in-progress", notionSynced: true });
  });

  it("returns 502 without touching the local file when the Notion write fails", async () => {
    mocks.updateStatus.mockRejectedValue(new Error("Notion request failed"));
    const response = await PATCH(request({ status: "in-progress", confirmed: true }), context);
    expect(response.status).toBe(502);
    expect(mocks.patchScalarField).not.toHaveBeenCalled();
  });
});
