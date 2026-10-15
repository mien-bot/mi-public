import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock("@/lib/content", () => ({ getProjectSlugs: () => ["demo"] }));
vi.mock("@/lib/content/projectPdf", () => ({ inspectProjectPdf: mocks.inspect }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/projects/demo/pdf-inspect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("project PDF inspection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspect.mockResolvedValue({ summary: { page_count: 11, link_annotations: 88 } });
  });

  it("returns a bounded project PDF extraction", async () => {
    const response = await POST(request({ relativePath: "example-record-17/evidence.pdf" }), {
      params: Promise.resolve({ slug: "demo" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ summary: { page_count: 11, link_annotations: 88 } });
    expect(mocks.inspect).toHaveBeenCalledWith("demo", "example-record-17/evidence.pdf", {
      firstPage: null,
      lastPage: null,
    });
  });

  it("passes a requested page range through so a long set can be read in slices", async () => {
    const response = await POST(
      request({ relativePath: "example-record-17/permit-set.pdf", firstPage: 40, lastPage: 60 }),
      { params: Promise.resolve({ slug: "demo" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.inspect).toHaveBeenCalledWith("demo", "example-record-17/permit-set.pdf", {
      firstPage: 40,
      lastPage: 60,
    });
  });

  it("rejects unknown projects, malformed bodies, and inspection failures", async () => {
    const missing = await POST(request({ relativePath: "evidence.pdf" }), {
      params: Promise.resolve({ slug: "missing" }),
    });
    expect(missing.status).toBe(404);

    const malformed = await POST(request({ relativePath: 42 }), {
      params: Promise.resolve({ slug: "demo" }),
    });
    expect(malformed.status).toBe(400);

    mocks.inspect.mockRejectedValueOnce(new Error("The PDF path escapes this project."));
    const failed = await POST(request({ relativePath: "../outside.pdf" }), {
      params: Promise.resolve({ slug: "demo" }),
    });
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({ error: "The PDF path escapes this project." });
  });
});
