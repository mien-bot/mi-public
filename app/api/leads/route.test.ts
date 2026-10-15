import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createLead: vi.fn(),
  updateLead: vi.fn(),
  previewLeadDropboxFolder: vi.fn(),
  applyLeadDropboxFolder: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/content", () => ({ getLastSiteVisitDate: vi.fn(), getSiteVisits: vi.fn(() => []) }));
vi.mock("@/lib/content/leadMutations", async () => {
  class LeadWriteError extends Error {
    constructor(message: string, readonly status = 400) { super(message); }
  }
  return { createLead: mocks.createLead, updateLead: mocks.updateLead, LeadWriteError };
});
vi.mock("@/lib/content/leadDropboxFolder", () => ({
  previewLeadDropboxFolder: mocks.previewLeadDropboxFolder,
  applyLeadDropboxFolder: mocks.applyLeadDropboxFolder,
}));
vi.mock("@/lib/content/paths", () => ({ DROPBOX_ROOT: "C:/Dropbox/STUDIO" }));
vi.mock("@/src/adapters/notion/leads", () => ({ createNotionLead: vi.fn() }));
vi.mock("@/src/policies/approvals", () => ({ isWriteAllowed: vi.fn(() => false) }));

import { POST } from "./route";

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createLead.mockImplementation((slug: string, lead: Record<string, unknown>) => ({
    slug,
    lead,
    previousConvertedProjectSlug: null,
  }));
  mocks.previewLeadDropboxFolder.mockImplementation((_root, relativePath, action) => ({
    action,
    relativePath,
    folders: action === "create" ? ["contracts", "Mi"] : [],
    behavior: "reviewed",
  }));
  mocks.applyLeadDropboxFolder.mockReturnValue({ createdFolders: [".", "contracts", "Mi"] });
});

describe("POST /api/leads Dropbox setup", () => {
  it("rejects an unconfirmed Dropbox choice before creating a lead", async () => {
    const response = await POST(request({
      slug: "demo",
      lead: { name: "Demo", dropbox_path: "1.01 LEADS/Demo" },
      dropboxAction: "create",
      dropboxConfirmed: false,
    }));
    expect(response.status).toBe(400);
    expect(mocks.createLead).not.toHaveBeenCalled();
    expect(mocks.applyLeadDropboxFolder).not.toHaveBeenCalled();
  });

  it("creates the reviewed Dropbox structure after the lead is saved", async () => {
    const response = await POST(request({
      slug: "demo",
      lead: { name: "Demo", dropbox_path: "1.01 LEADS/Demo" },
      dropboxAction: "create",
      dropboxConfirmed: true,
    }));
    expect(response.status).toBe(201);
    expect(mocks.previewLeadDropboxFolder).toHaveBeenCalledWith(
      "C:/Dropbox/STUDIO",
      "1.01 LEADS/Demo",
      "create",
    );
    expect(mocks.applyLeadDropboxFolder).toHaveBeenCalledOnce();
    expect((await response.json()).dropboxCreated).toBe(true);
  });

  it("links an existing folder without applying any Dropbox mutation", async () => {
    const response = await POST(request({
      slug: "demo",
      lead: { name: "Demo", dropbox_path: "1.01 LEADS/Existing" },
      dropboxAction: "link-existing",
      dropboxConfirmed: true,
    }));
    expect(response.status).toBe(201);
    expect(mocks.applyLeadDropboxFolder).not.toHaveBeenCalled();
    expect((await response.json()).dropboxAction).toBe("link-existing");
  });
});
