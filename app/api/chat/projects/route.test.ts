import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notion/projectMap", () => ({
  getUnifiedProjectList: () => [
    {
      slug: "demo",
      notionPageId: "notion-demo",
      name: "Demo project",
      status: "in-progress",
      client: "Demo client",
    },
  ],
}));

import { GET } from "./route";

describe("chat project picker route", () => {
  it("returns the narrow project picker DTO without caching", async () => {
    const response = GET();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      projects: [
        {
          slug: "demo",
          notionPageId: "notion-demo",
          name: "Demo project",
          status: "in-progress",
          client: "Demo client",
        },
      ],
    });
  });
});
