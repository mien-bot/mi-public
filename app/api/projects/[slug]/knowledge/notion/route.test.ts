import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ slugs: vi.fn(), export: vi.fn(), allowed: vi.fn(), preview: vi.fn(), publish: vi.fn(), config: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/content/projects", () => ({ getProjectSlugs: mocks.slugs }));
vi.mock("@/lib/content/projectKnowledgeExport", () => ({ projectKnowledgeExport: mocks.export }));
vi.mock("@/src/policies/approvals", () => ({ isWriteAllowed: mocks.allowed }));
vi.mock("@/src/services/projectKnowledgeNotion", () => ({ previewKnowledgePublish: mocks.preview, publishProjectKnowledge: mocks.publish }));
vi.mock("@/src/config", () => ({ loadMiConfig: mocks.config, patchMiConfig: mocks.patch }));
import { POST } from "./route";
const pageId = "11111111111111111111111111111111";
function post(body: unknown) {
  return POST(new Request("http://localhost/api/projects/sample/knowledge/notion", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ slug: "sample" }) });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.slugs.mockReturnValue(["sample"]); mocks.allowed.mockReturnValue(true);
  mocks.export.mockReturnValue({ project: { meta: { notion_page_id: pageId } }, entries: [{ title: "Fact", body: "Confirmed" }] });
  mocks.preview.mockResolvedValue({ entries: [] }); mocks.publish.mockResolvedValue({ published: 1 });
});
describe("knowledge publishing boundary", () => {
  it("previews without a Notion write", async () => {
    expect((await post({ action: "preview" })).status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith(pageId, [{ title: "Fact", body: "Confirmed" }]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("requires confirmation and a preview for publishing", async () => {
    expect((await post({ action: "publish" })).status).toBe(409);
    expect((await post({ action: "publish", confirmed: true })).status).toBe(409);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("ignores a caller-supplied page ID and uses only the stored link", async () => {
    const plan = { entries: [] };
    expect((await post({ action: "publish", confirmed: true, previewPlan: plan, pageId: "attacker" })).status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledWith(pageId, expect.any(Array), plan);
  });
  it("refuses missing links and disabled policy", async () => {
    mocks.allowed.mockReturnValue(false);
    expect((await post({ action: "preview" })).status).toBe(403);
    mocks.allowed.mockReturnValue(true);
    mocks.export.mockReturnValue({ project: { meta: { notion_page_id: null } }, entries: [] });
    expect((await post({ action: "preview" })).status).toBe(409);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("only adds the knowledge permission when explicitly confirmed, preserving other policy", async () => {
    mocks.config.mockReturnValue({ notion: { allowed_write_fields: { project: ["status"], task: [] } } });
    expect((await post({ action: "enable" })).status).toBe(409);
    expect(mocks.patch).not.toHaveBeenCalled();
    expect((await post({ action: "enable", confirmed: true })).status).toBe(200);
    expect(mocks.patch).toHaveBeenCalledWith({ allowed_write_fields: { project: ["status", "knowledge"], task: [] } });
  });
});
