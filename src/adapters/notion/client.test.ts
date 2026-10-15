import { afterEach, describe, expect, it, vi } from "vitest";
import { notionFetch } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NOTION_API_KEY;
});

describe("Notion API client", () => {
  it("retries a throttled request", async () => {
    process.env.NOTION_API_KEY = "test-token";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ code: "rate_limited", message: "Slow down" }),
        { status: 429, statusText: "Too Many Requests", headers: { "retry-after": "0" } },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(notionFetch<{ ok: boolean }>("/test")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer test-token",
      "Notion-Version": "2022-06-28",
    });
  });

  it("reports a concise structured error without dumping a raw response body", async () => {
    process.env.NOTION_API_KEY = "test-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "validation_error", message: "Invalid relation" }),
      { status: 400, statusText: "Bad Request" },
    )));

    await expect(notionFetch("/test")).rejects.toThrow(
      "Notion API 400 Bad Request: validation_error: Invalid relation",
    );
  });

  it("retries a transient network failure", async () => {
    process.env.NOTION_API_KEY = "test-token";
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("temporary socket failure"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(notionFetch<{ ok: boolean }>("/test")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
