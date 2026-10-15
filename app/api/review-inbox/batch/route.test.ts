import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), preview: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/content", () => ({ getProjectSlugs: () => ["alpha", "beta"], getLeadSlugs: () => [], getPermitQaqcSlugs: () => [] }));
vi.mock("@/lib/content/reviewInboxBatch", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/content/reviewInboxBatch")>(),
  confirmReviewBatch: mocks.confirm, previewReviewBatch: mocks.preview,
}));
import { POST } from "./route";
const groups = ["alpha", "beta"].map(slug => ({ kind: "project", slug, cardIds: ["id"], destinationKind: "project-notes" }));
const request = (body: unknown) => new Request("http://localhost/api/review-inbox/batch", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => vi.resetAllMocks());
describe("batch review endpoint", () => {
  it("requires explicit confirmation and rejects missing workspaces", async () => {
    expect((await POST(request({ action: "confirm", groups }))).status).toBe(400);
    expect((await POST(request({ action: "confirm", confirmed: true, groups: [{ ...groups[0], slug: "unknown" }] }))).status).toBe(404);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("previews without applying and passes exact confirmation through the batch guard", async () => {
    mocks.preview.mockReturnValue({ fingerprint: "preview", allowed: true });
    expect((await POST(request({ action: "preview", groups }))).status).toBe(200);
    expect(mocks.confirm).not.toHaveBeenCalled();
    mocks.confirm.mockReturnValue([{ kind: "project", slug: "alpha", applied: 1, failed: 0 }]);
    expect((await POST(request({ action: "confirm", groups, confirmed: true, fingerprint: "preview", reviewedBy: " Alex " }))).status).toBe(200);
    expect(mocks.confirm).toHaveBeenCalledWith(groups, "preview", "Alex");
    expect(mocks.revalidate).toHaveBeenCalledWith("/projects/beta", "layout");
  });
  it("rejects malformed or oversized selections before any apply", async () => {
    expect((await POST(request({ groups: [] }))).status).toBe(400);
    expect((await POST(request({ groups: [groups[0], groups[0]] }))).status).toBe(400);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
