import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), preview: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/content/reviewInboxDelete", async original => ({
  ...await original<typeof import("@/lib/content/reviewInboxDelete")>(),
  confirmInboxDelete: mocks.confirm, previewInboxDelete: mocks.preview,
}));
import { POST } from "./route";
const items = [{ kind: "permit-qaqc", slug: "fixture", cardId: "one" }];
const request = (body: object) => new Request("http://localhost/api/review-inbox/delete", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => vi.resetAllMocks());
it("requires both confirmations", async () => {
  for (const flags of [{}, { confirmed: true }, { confirmedAgain: true }]) {
    expect((await POST(request({ action: "delete", items, ...flags }))).status).toBe(400);
  }
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("previews without writing and passes the reviewed fingerprint on deletion", async () => {
  mocks.preview.mockReturnValue({ fingerprint: "exact", items });
  expect((await POST(request({ action: "preview", items }))).status).toBe(200);
  expect(mocks.confirm).not.toHaveBeenCalled();
  mocks.confirm.mockReturnValue([]);
  expect((await POST(request({ action: "delete", items, confirmed: true, confirmedAgain: true, fingerprint: "exact", reviewedBy: " Alex " }))).status).toBe(200);
  expect(mocks.confirm).toHaveBeenCalledWith(items, "exact", "Alex");
  expect(mocks.revalidate).toHaveBeenCalledWith("/permit-qaqc/fixture", "layout");
});
it("rejects malformed selections", async () => {
  expect((await POST(request({ action: "delete", items: [] }))).status).toBe(400);
  expect(mocks.confirm).not.toHaveBeenCalled();
});
