import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pull: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/content", () => ({ getProjectSlugs: () => ["demo"] }));
vi.mock("@/src/services/notionSync", () => ({ pullProjectFromNotion: mocks.pull }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { POST } from "./route";

const context = { params: Promise.resolve({ slug: "demo" }) };

function request(confirmed: boolean) {
  return new Request("http://localhost/api/projects/demo/notion-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmed }),
  });
}

describe("project Notion sync route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pull.mockResolvedValue({
      slug: "demo",
      changes: [{
        record: "schedule",
        field: "planned_date",
        from: null,
        to: { new_milestone: "Permit", planned_date: "2026-09-01" },
        allowed: true,
      }],
      applied: false,
    });
  });

  it("previews without applying or revalidating local project pages", async () => {
    const response = await POST(request(false), context);

    expect(response.status).toBe(200);
    expect(mocks.pull).toHaveBeenCalledWith("demo", { apply: false });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("applies only after explicit confirmation and refreshes project views", async () => {
    const response = await POST(request(true), context);

    expect(response.status).toBe(200);
    expect(mocks.pull).toHaveBeenCalledWith("demo", { apply: true });
    expect(mocks.revalidate).toHaveBeenCalledWith("/projects");
    expect(mocks.revalidate).toHaveBeenCalledWith("/projects/demo/schedule");
  });

  it("does not expose a sync control for an unknown local project", async () => {
    const response = await POST(request(false), {
      params: Promise.resolve({ slug: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.pull).not.toHaveBeenCalled();
  });
});
