import { describe, expect, it, vi } from "vitest";
import { searchAllNotionObjects } from "./notion-probe";

describe("Notion inventory probe", () => {
  it("paginates until every visible object has been read", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ object: "database", id: "db-1", url: "https://notion.so/db-1" }],
        has_more: true,
        next_cursor: "cursor-2",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ object: "page", id: "page-1", url: "https://notion.so/page-1" }],
        has_more: false,
        next_cursor: null,
      }), { status: 200 }));

    const results = await searchAllNotionObjects("test-token", fetchMock);

    expect(results.map((result) => result.id)).toEqual(["db-1", "page-1"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({
      start_cursor: "cursor-2",
    });
  });
});
