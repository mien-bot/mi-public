import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getToolkit: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/content", () => ({
  getProjectSlugs: vi.fn(() => ["demo"]),
  getProjectArchitectToolkitWithHash: mocks.getToolkit,
  previewArchitectToolOperation: mocks.preview,
  applyProjectArchitectToolOperation: mocks.apply,
}));
vi.mock("@/src/audit/log", () => ({ recordAudit: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "./route";

const operation = {
  kind: "add-product",
  value: {
    id: "product-12345678",
    category: "Seating",
    manufacturer: "example",
    product_name: "Task Chair",
    model: "A1",
    source: {
      title: "Manufacturer page",
      url: "https://example.com/chair",
      accessed_on: "2026-07-28",
      authority: "example",
      section: "",
      notes: "",
    },
    notes: "",
    status: "candidate",
    selected_by: null,
  },
};

describe("architect tools route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getToolkit.mockReturnValue({
      toolkit: { version: 1, products: [] },
      hash: "current-hash",
    });
    mocks.preview.mockReturnValue({ version: 1, products: [operation.value] });
    mocks.apply.mockReturnValue({
      toolkit: { version: 1, products: [operation.value] },
      hash: "next-hash",
      write: { backupPath: null },
    });
  });

  it("returns a side-effect-free preview with the conflict hash", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects/demo/architect-tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: false, operation }),
      }),
      { params: Promise.resolve({ slug: "demo" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      saved: false,
      expectedHash: "current-hash",
    });
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("refuses confirmation when the file changed after preview", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects/demo/architect-tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, expectedHash: "stale-hash", operation }),
      }),
      { params: Promise.resolve({ slug: "demo" }) },
    );
    expect(response.status).toBe(409);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("writes and audits only after explicit confirmation", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects/demo/architect-tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, expectedHash: "current-hash", operation }),
      }),
      { params: Promise.resolve({ slug: "demo" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.apply).toHaveBeenCalledWith({
      slug: "demo",
      operation: expect.objectContaining({ kind: "add-product" }),
      expectedHash: "current-hash",
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      diff: { kind: "add-product", id: "product-12345678" },
      applied: true,
    }));
  });
});
