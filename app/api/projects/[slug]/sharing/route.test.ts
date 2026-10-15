import { describe, expect, it, vi } from "vitest";
const sharing = vi.hoisted(() => ({ previewProjectHandoff: vi.fn(() => ({ fingerprint: "reviewed" })), saveProjectHandoff: vi.fn(), previewProjectPdf: vi.fn(), saveProjectPdf: vi.fn() }));
vi.mock("@/lib/content/projectSharing", () => sharing);
import { POST } from "./route";
const context = { params: Promise.resolve({ slug: "fixture" }) };
describe("project sharing boundary", () => {
  it("accepts the actual loopback browser host even when Next uses localhost internally", async () => {
    const request = new Request("http://localhost:3051/api/projects/fixture/sharing", { method: "POST", headers: { origin: "http://127.0.0.1:3051", host: "127.0.0.1:3051", "content-type": "application/json" }, body: JSON.stringify({ action: "preview", draft: {} }) });
    expect((await POST(request, context)).status).toBe(200);
    expect(sharing.saveProjectHandoff).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests and wrong ports", async () => {
    for (const origin of ["https://example.com", "http://127.0.0.1:9999", "null"]) {
      const request = new Request("http://localhost:3051/api/projects/fixture/sharing", { method: "POST", headers: { origin, host: "127.0.0.1:3051" }, body: "{}" });
      expect((await POST(request, context)).status).toBe(403);
    }
  });
});
