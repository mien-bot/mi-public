import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn(), audit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/content", () => ({ getProjectSlugs: () => ["demo"] }));
vi.mock("@/lib/content/milestoneBatch", () => ({ previewMilestoneBatch: mocks.preview, applyMilestoneBatch: mocks.apply }));
vi.mock("@/src/audit/log", () => ({ recordAudit: mocks.audit }));
import { POST } from "./route";
const context = { params: Promise.resolve({ slug: "demo" }) };
const body = { action: "archive", ids: ["m1"], expectedHash: "hash" };
function request(data: unknown) { return new Request("http://localhost/api/projects/demo/schedule/batch", { method: "POST", body: JSON.stringify(data) }); }
beforeEach(() => { vi.resetAllMocks(); mocks.preview.mockResolvedValue({ fingerprint: "review" }); mocks.apply.mockResolvedValue({ results: [{ id: "m1", status: "applied" }], hash: "new" }); });
it("requires the rendered hash and an explicit confirmation with a review fingerprint", async () => {
  expect((await POST(request({ action: "archive", ids: ["m1"] }), context)).status).toBe(400);
  expect((await POST(request({ ...body, confirmed: true }), context)).status).toBe(409);
  expect(mocks.apply).not.toHaveBeenCalled();
});
it("defaults to preview and never applies without confirmation", async () => {
  expect((await POST(request(body), context)).status).toBe(200);
  expect(mocks.preview).toHaveBeenCalledOnce(); expect(mocks.apply).not.toHaveBeenCalled();
});
it("rejects projects outside the known registry", async () => {
  expect((await POST(request(body), { params: Promise.resolve({ slug: "../other" }) })).status).toBe(404);
  expect(mocks.preview).not.toHaveBeenCalled();
});
it("keeps successful results when the audit fails after a confirmed write", async () => {
  mocks.audit.mockImplementation(() => { throw Error("disk locked"); });
  const response = await POST(request({ ...body, confirmed: true, fingerprint: "review" }), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ results: [{ status: "applied" }], warning: expect.stringContaining("audit") });
});
