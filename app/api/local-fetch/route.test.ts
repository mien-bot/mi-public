import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchLocal: vi.fn() }));
vi.mock("@/electron/localFetch", () => ({ fetchLocalUrl: mocks.fetchLocal }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/local-fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("local fetch route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MI_LOCAL_FETCH;
    mocks.fetchLocal.mockResolvedValue({
      tier: "http",
      status: 200,
      final_url: "https://www.chicago.gov/sbif",
      text: "# SBIF",
      retrieved_at: "2026-08-06T12:00:00.000Z",
    });
  });

  afterEach(() => {
    delete process.env.MI_LOCAL_FETCH;
  });

  it("reads a URL locally and defaults to auto mode", async () => {
    const response = await POST(request({ url: "https://www.chicago.gov/sbif" }));
    expect(response.status).toBe(200);
    expect((await response.json()).tier).toBe("http");
    expect(mocks.fetchLocal).toHaveBeenCalledWith({
      url: "https://www.chicago.gov/sbif",
      mode: "auto",
      refresh: false,
    });
  });

  it("passes an explicit mode and refresh through", async () => {
    await POST(request({ url: "https://www.chicago.gov/sbif", mode: "browser", refresh: true }));
    expect(mocks.fetchLocal).toHaveBeenCalledWith({
      url: "https://www.chicago.gov/sbif",
      mode: "browser",
      refresh: true,
    });
  });

  it("rejects a malformed body, an oversized URL, and an unknown mode", async () => {
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ url: 42 }))).status).toBe(400);
    expect((await POST(request({ url: `https://example.org/${"a".repeat(2_000)}` }))).status).toBe(400);
    expect((await POST(request({ url: "https://example.org/", mode: "sideways" }))).status).toBe(400);
    expect(mocks.fetchLocal).not.toHaveBeenCalled();
  });

  it("surfaces the reader's own refusal message rather than a generic failure", async () => {
    mocks.fetchLocal.mockRejectedValueOnce(new Error("Mi's local fetch reads public pages only, not local or private hosts."));
    const response = await POST(request({ url: "http://localhost:3000/api" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Mi's local fetch reads public pages only, not local or private hosts.",
    });
  });

  it("can be switched off for a machine that must not read the web", async () => {
    for (const value of ["off", "0", "false"]) {
      process.env.MI_LOCAL_FETCH = value;
      const response = await POST(request({ url: "https://www.chicago.gov/sbif" }));
      expect(response.status, value).toBe(403);
    }
    expect(mocks.fetchLocal).not.toHaveBeenCalled();
  });
});
