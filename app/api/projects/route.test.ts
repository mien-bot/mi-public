import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-project-create-"));
  roots.push(root);
  return root;
}

const mocks = vi.hoisted(() => ({
  getProjectSlugs: vi.fn(() => [] as string[]),
  mirrorProjectKnowledge: vi.fn(),
  scaffoldProject: vi.fn(),
  createStudioProject: vi.fn(),
  recordAudit: vi.fn(),
}));

let dropboxRoot: string;
let projectsDir: string;
let repoRoot: string;
vi.mock("@/lib/content", () => ({
  getProjectSlugs: mocks.getProjectSlugs,
  mirrorProjectKnowledge: mocks.mirrorProjectKnowledge,
}));
vi.mock("@/lib/content/paths", () => ({
  get DROPBOX_ROOT() { return dropboxRoot; },
  get PROJECTS_DIR() { return projectsDir; },
  get REPO_ROOT() { return repoRoot; },
}));
vi.mock("@/lib/content/scaffoldProject", () => ({ scaffoldProject: mocks.scaffoldProject }));
vi.mock("@/src/adapters/notion/studioProjects", () => ({ createStudioProject: mocks.createStudioProject }));
vi.mock("@/src/audit/log", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "./route";

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Demo Project",
    slug: "demo-project",
    client: "Acme",
    location: "Chicago",
    status: "not-started",
    workflow: "architecture",
    projectType: null,
    scopes: [],
    dropboxFolder: "12_Demo Project",
    ...overrides,
  };
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

beforeEach(() => {
  dropboxRoot = temporaryRoot();
  fs.mkdirSync(path.join(dropboxRoot, "1.00 PROJECTS"), { recursive: true });
  projectsDir = path.join(temporaryRoot(), "projects");
  repoRoot = temporaryRoot();
  mocks.getProjectSlugs.mockReturnValue([]);
  mocks.createStudioProject.mockResolvedValue({ id: "notion-page-id", url: "https://notion.so/demo" });
});

describe("POST /api/projects", () => {
  it("previews without creating anything", async () => {
    const response = await POST(request({ ...basePayload(), confirmed: false }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.plan.dropbox.folders).toEqual([
      "00_Reference",
      "01_Admin", "02_Pre-Design", "03_Production", "04_Presentation", "05_Plot", "06_Corr", "07_Specs",
      "08_3DModels", "09_SitePhotos",
    ]);
    expect(mocks.createStudioProject).not.toHaveBeenCalled();
    expect(mocks.scaffoldProject).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dropboxRoot, "1.00 PROJECTS", "12_Demo Project"))).toBe(false);
  });

  it("creates real Dropbox folders (including an empty Mi/), one Notion page, and the local scaffold on confirm", async () => {
    const preview = await (await POST(request({ ...basePayload(), confirmed: false }))).json();
    const requestId = "11111111-1111-1111-1111-111111111111";
    const response = await POST(request({
      ...basePayload(), confirmed: true, clientRequestId: requestId, previewPlan: preview.plan,
    }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.slug).toBe("demo-project");

    const target = path.join(dropboxRoot, "1.00 PROJECTS", "12_Demo Project");
    expect(fs.existsSync(path.join(target, "Mi"))).toBe(true);
    expect(fs.existsSync(path.join(target, "01_Admin"))).toBe(true);
    expect(fs.existsSync(path.join(target, "07_Specs"))).toBe(true);
    expect(fs.existsSync(path.join(target, "00_Reference"))).toBe(true);
    expect(fs.existsSync(path.join(target, "08_3DModels"))).toBe(true);
    expect(fs.existsSync(path.join(target, "09_SitePhotos"))).toBe(true);
    expect(fs.readFileSync(path.join(target, "README.md"), "utf8")).toContain("Project folder conventions");
    expect(fs.readFileSync(path.join(target, ".dropboxignore"), "utf8")).toContain("*.dwl");
    expect(mocks.createStudioProject).toHaveBeenCalledTimes(1);
    expect(mocks.scaffoldProject).toHaveBeenCalledWith("demo-project", "Demo Project", expect.objectContaining({
      notionPageId: "notion-page-id",
      dropboxPath: "1.00 PROJECTS/12_Demo Project",
    }));
    expect(mocks.mirrorProjectKnowledge).toHaveBeenCalledWith("demo-project");
  });

  it("respects an edited folder list instead of the profile default", async () => {
    const payload = { ...basePayload(), folders: ["01_Admin", "08_Renderings"] };
    const preview = await (await POST(request({ ...payload, confirmed: false }))).json();
    expect(preview.plan.dropbox.folders).toEqual(["01_Admin", "08_Renderings"]);

    const requestId = "22222222-2222-2222-2222-222222222222";
    await POST(request({ ...payload, confirmed: true, clientRequestId: requestId, previewPlan: preview.plan }));
    const target = path.join(dropboxRoot, "1.00 PROJECTS", "12_Demo Project");
    expect(fs.existsSync(path.join(target, "08_Renderings"))).toBe(true);
    expect(fs.existsSync(path.join(target, "02_Pre-Design"))).toBe(false);
  });

  it("links an existing selected Dropbox folder without adding or changing its contents", async () => {
    const existing = path.join(dropboxRoot, "1.00 PROJECTS", "09_Existing Project");
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(path.join(existing, "keep.txt"), "unchanged", "utf8");
    const payload = basePayload({
      dropboxMode: "link-existing",
      dropboxPath: "1.00 PROJECTS/09_Existing Project",
      dropboxFolder: "",
    });

    const previewResponse = await POST(request({ ...payload, confirmed: false }));
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    expect(preview.plan.dropbox.mode).toBe("link-existing");
    expect(preview.plan.dropbox.folders).toEqual([]);

    const response = await POST(request({
      ...payload,
      confirmed: true,
      clientRequestId: "66666666-6666-6666-6666-666666666666",
      previewPlan: preview.plan,
    }));
    expect(response.status).toBe(200);
    expect(fs.readdirSync(existing)).toEqual(["keep.txt"]);
    expect(mocks.scaffoldProject).toHaveBeenCalledWith(
      "demo-project",
      "Demo Project",
      expect.objectContaining({ dropboxPath: "1.00 PROJECTS/09_Existing Project" }),
    );
  });

  it("rejects a missing folder chosen for existing-folder linking", async () => {
    const response = await POST(request({
      ...basePayload(),
      dropboxMode: "link-existing",
      dropboxPath: "1.00 PROJECTS/Missing",
      confirmed: false,
    }));
    expect(response.status).toBe(409);
  });

  it("rejects an edited folder list containing traversal", async () => {
    const response = await POST(request({ ...basePayload(), folders: ["../escape"], confirmed: false }));
    expect(response.status).toBe(400);
  });

  it("rejects a confirm whose echoed previewPlan differs from what the server would build", async () => {
    const preview = await (await POST(request({ ...basePayload(), confirmed: false }))).json();
    const tampered = { ...preview.plan, dropbox: { ...preview.plan.dropbox, relativePath: "1.00 PROJECTS/Somewhere Else" } };
    const response = await POST(request({
      ...basePayload(), confirmed: true, clientRequestId: "33333333-3333-3333-3333-333333333333", previewPlan: tampered,
    }));
    expect(response.status).toBe(409);
    expect(mocks.createStudioProject).not.toHaveBeenCalled();
  });

  it("creates Dropbox folders but blocks retry when the Notion create result is uncertain, and never auto-retries it", async () => {
    mocks.createStudioProject.mockRejectedValue(new Error("network timeout"));
    const preview = await (await POST(request({ ...basePayload(), confirmed: false }))).json();
    const requestId = "44444444-4444-4444-4444-444444444444";
    const failed = await POST(request({
      ...basePayload(), confirmed: true, clientRequestId: requestId, previewPlan: preview.plan,
    }));
    expect(failed.status).toBe(502);
    const target = path.join(dropboxRoot, "1.00 PROJECTS", "12_Demo Project");
    expect(fs.existsSync(path.join(target, "01_Admin"))).toBe(true); // Dropbox side already happened

    // Retrying the same request must not call Notion again -- it must block for manual review.
    mocks.createStudioProject.mockClear();
    const retried = await POST(request({
      ...basePayload(), confirmed: true, clientRequestId: requestId, previewPlan: preview.plan,
    }));
    expect(retried.status).toBe(409);
    expect(mocks.createStudioProject).not.toHaveBeenCalled();
  });

  it("returns alreadyApplied instead of recreating anything when retried after completion", async () => {
    const preview = await (await POST(request({ ...basePayload(), confirmed: false }))).json();
    const requestId = "55555555-5555-5555-5555-555555555555";
    await POST(request({ ...basePayload(), confirmed: true, clientRequestId: requestId, previewPlan: preview.plan }));
    mocks.createStudioProject.mockClear();
    mocks.scaffoldProject.mockClear();

    const retried = await POST(request({
      ...basePayload(), confirmed: true, clientRequestId: requestId, previewPlan: preview.plan,
    }));
    expect(retried.status).toBe(200);
    const data = await retried.json();
    expect(data.alreadyApplied).toBe(true);
    expect(mocks.createStudioProject).not.toHaveBeenCalled();
    expect(mocks.scaffoldProject).not.toHaveBeenCalled();
  });
});
