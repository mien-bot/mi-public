import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pull: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/content", () => ({
  getProjectSlugs: () => ["linked", "local"],
  getProject: (slug: string) => ({
    meta: { name: slug === "linked" ? "Linked project" : "Local project", notion_page_id: slug === "linked" ? "page" : null },
  }),
}));
vi.mock("@/src/services/notionSync", () => ({ pullProjectFromNotion: mocks.pull }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { POST } from "./route";

function request(confirmed: boolean) {
  return new Request("http://localhost/api/projects/notion-sync", {
    method: "POST",
    body: JSON.stringify({ confirmed }),
  });
}

describe("all-project Notion sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pull.mockResolvedValue({ slug: "linked", changes: [], applied: false });
  });

  it("previews only projects with human-confirmed Notion links", async () => {
    const response = await POST(request(false));
    const body = await response.json();
    expect(mocks.pull).toHaveBeenCalledTimes(1);
    expect(mocks.pull).toHaveBeenCalledWith("linked", { apply: false });
    expect(body.skipped).toBe(1);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("applies after confirmation and refreshes aggregate analysis", async () => {
    await POST(request(true));
    expect(mocks.pull).toHaveBeenCalledWith("linked", { apply: true });
    expect(mocks.revalidate).toHaveBeenCalledWith("/projects/analysis");
  });
});
