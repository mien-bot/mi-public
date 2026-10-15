import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leadSchema, type Lead } from "@/lib/schema";

const roots: string[] = [];
function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-lead-convert-"));
  roots.push(root);
  return root;
}

const mocks = vi.hoisted(() => ({
  getLeadSlugs: vi.fn(() => ["acme-clinic"]),
  getLead: vi.fn(),
  getProjectSlugs: vi.fn(() => [] as string[]),
  getProjectDetails: vi.fn(() => ({ fee: null })),
  writeProjectDetails: vi.fn(),
  appendProjectMemoryNote: vi.fn(),
  mirrorProjectKnowledge: vi.fn(),
  scaffoldProject: vi.fn(),
  updateLead: vi.fn(),
  syncLeadToNotion: vi.fn(),
  createStudioProject: vi.fn(),
  recordAudit: vi.fn(),
}));

let dropboxRoot: string;
let projectsDir: string;
let repoRoot: string;
let leadsDir: string;

vi.mock("@/lib/content", () => ({
  getLeadSlugs: mocks.getLeadSlugs,
  getLead: mocks.getLead,
  getProjectSlugs: mocks.getProjectSlugs,
  getProjectDetails: mocks.getProjectDetails,
  writeProjectDetails: mocks.writeProjectDetails,
  appendProjectMemoryNote: mocks.appendProjectMemoryNote,
  mirrorProjectKnowledge: mocks.mirrorProjectKnowledge,
}));
vi.mock("@/lib/content/paths", () => ({
  get DROPBOX_ROOT() { return dropboxRoot; },
  get PROJECTS_DIR() { return projectsDir; },
  get REPO_ROOT() { return repoRoot; },
  resolveFirmDataDir: () => ({ dir: leadsDir, shared: true }),
}));
vi.mock("@/lib/content/scaffoldProject", () => ({ scaffoldProject: mocks.scaffoldProject }));
vi.mock("@/lib/content/leadMutations", () => ({
  updateLead: mocks.updateLead,
  LeadWriteError: class LeadWriteError extends Error {
    constructor(message: string, readonly status = 400) { super(message); }
  },
}));
vi.mock("@/lib/content/leadNotionSync", () => ({ syncLeadToNotion: mocks.syncLeadToNotion }));
vi.mock("@/src/adapters/notion/studioProjects", () => ({ createStudioProject: mocks.createStudioProject }));
vi.mock("@/src/audit/log", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "./route";

function lead(overrides: Partial<Lead> = {}): Lead {
  return leadSchema.parse({
    name: "Acme Clinic",
    source: "referral",
    contact_name: "Dana Reed",
    date_received: "2026-05-04",
    status: "proposal-sent",
    estimated_value: 42000,
    notes: "Waiting room first.",
    ...overrides,
  });
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/leads/acme-clinic/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function post(body: Record<string, unknown>) {
  return POST(request(body), { params: Promise.resolve({ slug: "acme-clinic" }) });
}

async function preview(body: Record<string, unknown> = {}) {
  const response = await post({ ...body, confirmed: false });
  return { status: response.status, data: await response.json() };
}

beforeEach(() => {
  dropboxRoot = temporaryRoot();
  fs.mkdirSync(path.join(dropboxRoot, "1.00 PROJECTS"), { recursive: true });
  projectsDir = path.join(temporaryRoot(), "projects");
  repoRoot = temporaryRoot();
  leadsDir = temporaryRoot();

  const leadRoot = path.join(leadsDir, "acme-clinic");
  fs.mkdirSync(path.join(leadRoot, "site-photos"), { recursive: true });
  fs.writeFileSync(path.join(leadRoot, "site-photos", "front.jpg"), "photo", "utf8");
  fs.writeFileSync(
    path.join(leadRoot, "site-photos", "index.yaml"),
    "- file: front.jpg\n  caption: Front elevation\n  added_date: \"2026-05-05\"\n",
    "utf8",
  );

  mocks.getLeadSlugs.mockReturnValue(["acme-clinic"]);
  mocks.getLead.mockReturnValue({ slug: "acme-clinic", lead: lead() });
  mocks.getProjectSlugs.mockReturnValue([]);
  mocks.getProjectDetails.mockReturnValue({ fee: null });
  mocks.updateLead.mockImplementation((_slug: string, input: Lead) => ({ lead: input }));
  mocks.syncLeadToNotion.mockResolvedValue({ notionSynced: true, notionError: null });
  mocks.createStudioProject.mockResolvedValue({ id: "notion-page-id", url: "https://notion.so/acme" });
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("POST /api/leads/[slug]/convert", () => {
  it("uses only the street for the preview and created project, retaining the source lead name", async () => {
    const original = lead({ name: "1002 S Example Blvd, Chicago, Illinois 60616" });
    mocks.getLead.mockReturnValue({ slug: "acme-clinic", lead: original });
    const { status, data } = await preview();
    expect(status).toBe(200);
    expect(data.plan.project.project).toMatchObject({ name: "1002 S Example Blvd", slug: "1002-s-example-blvd" });
    expect(data.plan.project.dropbox.relativePath).toBe("1.00 PROJECTS/1002 S Example Blvd");
    expect(data.plan.lead.name).toBe(original.name);

    const response = await post({
      confirmed: true,
      clientRequestId: "88888888-8888-8888-8888-888888888888",
      previewPlan: data.plan,
    });
    expect(response.status).toBe(200);
    expect(mocks.scaffoldProject).toHaveBeenCalledWith("1002-s-example-blvd", "1002 S Example Blvd", expect.any(Object));
    expect(mocks.createStudioProject).toHaveBeenCalledWith(expect.objectContaining({ name: "1002 S Example Blvd" }));
    expect(mocks.updateLead).toHaveBeenCalledWith("acme-clinic", expect.objectContaining({ name: original.name }));
  });

  it("previews the folder, the lead material, and the Notion page without creating anything", async () => {
    const { status, data } = await preview({ dropboxFolder: "12_Acme Clinic" });

    expect(status).toBe(200);
    expect(data.plan.project.dropbox.relativePath).toBe("1.00 PROJECTS/12_Acme Clinic");
    expect(data.plan.project.dropbox.folders).toContain("09_SitePhotos");
    expect(data.plan.seed.copies).toEqual([
      expect.objectContaining({ target: "09_SitePhotos/From-Lead/front.jpg", label: "Front elevation" }),
    ]);
    expect(data.handoffPreview).toContain("# Lead handoff — Acme Clinic");
    expect(fs.existsSync(path.join(dropboxRoot, "1.00 PROJECTS", "12_Acme Clinic"))).toBe(false);
    expect(mocks.createStudioProject).not.toHaveBeenCalled();
    expect(mocks.scaffoldProject).not.toHaveBeenCalled();
    expect(mocks.updateLead).not.toHaveBeenCalled();
  });

  it("creates the folder, seeds the lead's data into it, and links project, lead, and Notion", async () => {
    const { data } = await preview({ dropboxFolder: "12_Acme Clinic" });
    const response = await post({
      dropboxFolder: "12_Acme Clinic",
      folders: data.plan.project.dropbox.folders,
      confirmed: true,
      clientRequestId: "11111111-1111-1111-1111-111111111111",
      previewPlan: data.plan,
    });
    expect(response.status).toBe(200);
    const result = await response.json();

    const target = path.join(dropboxRoot, "1.00 PROJECTS", "12_Acme Clinic");
    expect(fs.existsSync(path.join(target, "01_Admin"))).toBe(true);
    expect(fs.existsSync(path.join(target, "Mi"))).toBe(true);
    expect(fs.readFileSync(path.join(target, "README.md"), "utf8")).toContain("Project folder conventions");
    expect(fs.readFileSync(path.join(target, "Lead-Handoff.md"), "utf8")).toContain("Waiting room first.");
    expect(fs.readFileSync(path.join(target, "09_SitePhotos", "From-Lead", "front.jpg"), "utf8")).toBe("photo");
    // The lead keeps its own copy -- conversion copies, never moves.
    expect(fs.existsSync(path.join(leadsDir, "acme-clinic", "site-photos", "front.jpg"))).toBe(true);

    expect(mocks.scaffoldProject).toHaveBeenCalledWith("acme-clinic", "Acme Clinic", expect.objectContaining({
      client: "Dana Reed",
      notionPageId: "notion-page-id",
      dropboxPath: "1.00 PROJECTS/12_Acme Clinic",
    }));
    expect(mocks.writeProjectDetails).toHaveBeenCalledWith("acme-clinic", expect.objectContaining({ fee: 42000 }));
    expect(mocks.updateLead).toHaveBeenCalledWith("acme-clinic", expect.objectContaining({
      converted_project_slug: "acme-clinic",
      status: "won",
    }));
    expect(mocks.mirrorProjectKnowledge).toHaveBeenCalledWith("acme-clinic");
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ command: "lead convert confirmed" }));
    expect(result.seededFiles).toEqual(["Lead-Handoff.md", "09_SitePhotos/From-Lead/front.jpg"]);
    expect(result.dropboxPath).toBe("1.00 PROJECTS/12_Acme Clinic");
  });

  it("sends lead files to 00_From-Lead when their destination folder was removed", async () => {
    const first = await preview({ dropboxFolder: "12_Acme Clinic" });
    const folders = first.data.plan.project.dropbox.folders.filter((folder: string) => folder !== "09_SitePhotos");
    const { data } = await preview({ dropboxFolder: "12_Acme Clinic", folders });

    expect(data.plan.seed.copies[0].target).toBe("00_From-Lead/site-photos/front.jpg");

    await post({
      dropboxFolder: "12_Acme Clinic",
      folders,
      confirmed: true,
      clientRequestId: "77777777-7777-7777-7777-777777777777",
      previewPlan: data.plan,
    });
    const target = path.join(dropboxRoot, "1.00 PROJECTS", "12_Acme Clinic");
    expect(fs.existsSync(path.join(target, "00_From-Lead", "site-photos", "front.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(target, "09_SitePhotos"))).toBe(false);
  });

  it("skips Notion entirely when asked to, and still creates folder and project", async () => {
    const { data } = await preview({ dropboxFolder: "12_Acme Clinic", notionPage: "skip" });
    const response = await post({
      dropboxFolder: "12_Acme Clinic",
      notionPage: "skip",
      folders: data.plan.project.dropbox.folders,
      confirmed: true,
      clientRequestId: "22222222-2222-2222-2222-222222222222",
      previewPlan: data.plan,
    });

    expect(response.status).toBe(200);
    expect(mocks.createStudioProject).not.toHaveBeenCalled();
    expect(mocks.scaffoldProject).toHaveBeenCalledWith("acme-clinic", "Acme Clinic", expect.objectContaining({
      notionPageId: null,
    }));
  });

  it("rejects a confirm whose echoed plan differs from what the server would build", async () => {
    const { data } = await preview({ dropboxFolder: "12_Acme Clinic" });
    const tampered = {
      ...data.plan,
      project: {
        ...data.plan.project,
        dropbox: { ...data.plan.project.dropbox, relativePath: "1.00 PROJECTS/Somewhere Else" },
      },
    };
    const response = await post({
      dropboxFolder: "12_Acme Clinic",
      folders: data.plan.project.dropbox.folders,
      confirmed: true,
      clientRequestId: "33333333-3333-3333-3333-333333333333",
      previewPlan: tampered,
    });

    expect(response.status).toBe(409);
    expect(mocks.createStudioProject).not.toHaveBeenCalled();
    expect(mocks.scaffoldProject).not.toHaveBeenCalled();
  });

  it("refuses to convert a lead that already became a project", async () => {
    mocks.getLead.mockReturnValue({
      slug: "acme-clinic",
      lead: lead({ converted_project_slug: "acme-clinic", converted_date: "2026-06-01" }),
    });
    const response = await post({ confirmed: false });
    expect(response.status).toBe(409);
  });

  it("blocks a retry when the Notion result is uncertain instead of risking a duplicate page", async () => {
    mocks.createStudioProject.mockRejectedValue(new Error("network timeout"));
    const { data } = await preview({ dropboxFolder: "12_Acme Clinic" });
    const body = {
      dropboxFolder: "12_Acme Clinic",
      folders: data.plan.project.dropbox.folders,
      confirmed: true,
      clientRequestId: "44444444-4444-4444-4444-444444444444",
      previewPlan: data.plan,
    };

    const failed = await post(body);
    expect(failed.status).toBe(502);
    // The Dropbox side already happened, and the lead is deliberately left unconverted.
    const target = path.join(dropboxRoot, "1.00 PROJECTS", "12_Acme Clinic");
    expect(fs.existsSync(path.join(target, "Lead-Handoff.md"))).toBe(true);
    expect(mocks.updateLead).not.toHaveBeenCalled();

    mocks.createStudioProject.mockClear();
    const retried = await post(body);
    expect(retried.status).toBe(409);
    expect(mocks.createStudioProject).not.toHaveBeenCalled();
  });

  it("resumes at the lead link, without a second project or Notion page, after that step failed", async () => {
    mocks.updateLead.mockImplementationOnce(() => { throw new Error("lead.yaml changed on disk"); });
    const { data } = await preview({ dropboxFolder: "12_Acme Clinic" });
    const body = {
      dropboxFolder: "12_Acme Clinic",
      folders: data.plan.project.dropbox.folders,
      confirmed: true,
      clientRequestId: "55555555-5555-5555-5555-555555555555",
      previewPlan: data.plan,
    };

    const failed = await post(body);
    expect(failed.status).toBe(500);
    expect(mocks.scaffoldProject).toHaveBeenCalledTimes(1);

    // projects/<slug>/ now exists because this request created it -- a retry must resume, not refuse.
    mocks.getProjectSlugs.mockReturnValue(["acme-clinic"]);
    const retried = await post(body);
    expect(retried.status).toBe(200);
    expect(mocks.scaffoldProject).toHaveBeenCalledTimes(1);
    expect(mocks.createStudioProject).toHaveBeenCalledTimes(1);
    expect(mocks.updateLead).toHaveBeenCalledTimes(2);
  });

  it("returns alreadyApplied instead of converting twice when retried after completion", async () => {
    const { data } = await preview({ dropboxFolder: "12_Acme Clinic" });
    const body = {
      dropboxFolder: "12_Acme Clinic",
      folders: data.plan.project.dropbox.folders,
      confirmed: true,
      clientRequestId: "66666666-6666-6666-6666-666666666666",
      previewPlan: data.plan,
    };
    await post(body);
    mocks.scaffoldProject.mockClear();
    mocks.createStudioProject.mockClear();
    mocks.updateLead.mockClear();

    const retried = await post(body);
    expect(retried.status).toBe(200);
    expect((await retried.json()).alreadyApplied).toBe(true);
    expect(mocks.scaffoldProject).not.toHaveBeenCalled();
    expect(mocks.createStudioProject).not.toHaveBeenCalled();
    expect(mocks.updateLead).not.toHaveBeenCalled();
  });
});
