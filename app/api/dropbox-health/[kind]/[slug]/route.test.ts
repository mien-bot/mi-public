import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ root: vi.fn(async () => "fixture"), apply: vi.fn(async () => {}), read: vi.fn(async () => ({ state: "available", cloudSync: "unverified" })) }));
vi.mock("@/lib/content/dropboxWorkspace", () => ({ dropboxWorkspaceRoot: mocks.root }));
vi.mock("@/lib/content/dropboxHealth", () => ({ applyDropboxReview: mocks.apply, readDropboxHealth: mocks.read, reviewDropboxFile: vi.fn() }));
import { GET, POST } from "./route";
const context = { params: Promise.resolve({ kind: "projects", slug: "fixture" }) };
const url = "http://127.0.0.1:3050/api/dropbox-health/projects/fixture";
const confirmation = { confirmed: true, kind: "conflict", path: "notes (conflicted copy).txt", target: "notes.txt", currentHash: "a".repeat(64), proposedHash: "b".repeat(64) };
beforeEach(() => vi.clearAllMocks());
describe("local Dropbox recovery boundary", () => {
  it("serves local health without caching and denies remote identities", async () => {
    const result = await GET(new Request(url), context);
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
    expect((await GET(new Request(url, { headers: { "cf-connecting-ip": "203.0.113.1" } }), context)).status).toBe(400);
  });
  it("requires same-origin and exact explicit confirmation before any mutation", async () => {
    for (const [origin, body] of [["https://evil.example", confirmation], ["http://127.0.0.1:3050", { ...confirmation, confirmed: false }], ["http://127.0.0.1:3050", { ...confirmation, currentHash: undefined }]]) {
      const result = await POST(new Request(url, { method: "POST", headers: { origin: String(origin) }, body: JSON.stringify(body) }), context);
      expect(result.status).toBe(409);
    }
    expect(mocks.apply).not.toHaveBeenCalled();
    const result = await POST(new Request(url, { method: "POST", headers: { origin: "http://127.0.0.1:3050" }, body: JSON.stringify(confirmation) }), context);
    expect(result.status).toBe(200); expect(mocks.apply).toHaveBeenCalledOnce();
  });
});
