import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ append: vi.fn(), hash: vi.fn() }));
vi.mock("@/lib/content/projects", () => ({ getProjectSlugs: () => ["sample"] }));
vi.mock("@/lib/content/projectWorkspace", () => ({ appendProjectMemoryNote: mocks.append, memoryNotesPath: () => "sample/memory/notes.md" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/content/atomicContentWrite", () => ({ readCurrentHash: mocks.hash, ContentConflictError: class extends Error {} }));
import { POST } from "./route";
function post(body: unknown) { return POST(new Request("http://localhost/knowledge", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ slug: "sample" }) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.hash.mockReturnValue("new-hash"); });
describe("confirmed knowledge notes", () => {
  it("requires the existing-file hash and confirmation", async () => {
    expect((await post({ title: "Fact", entry: "Evidence" })).status).toBe(400);
    expect((await post({ title: "Fact", entry: "Evidence", confirmed: true })).status).toBe(400);
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("appends a dated note using the reviewed hash", async () => {
    const result = await post({ title: "Fact", entry: "Evidence", confirmed: true, expectedHash: "old-hash" });
    expect(result.status).toBe(200);
    expect(mocks.append).toHaveBeenCalledWith("sample", { title: expect.stringContaining(" — Fact"), entry: "Evidence" }, { expectedHash: "old-hash" });
    expect(await result.json()).toEqual({ saved: true, hash: "new-hash" });
  });
});
