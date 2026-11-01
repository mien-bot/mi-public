import { describe, expect, it, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const google = require("./googleCalendar");

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe("Google Calendar connection", () => {
  it("asks only for read access, with PKCE", () => {
    const url = new URL(google.buildAuthUrl({ clientId: "id", redirectUri: "http://127.0.0.1:1/callback", state: "s", challenge: "c" }));
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.readonly");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("completes sign-in through the loopback redirect", async () => {
    const fetchImpl = vi.fn(async () => json({ refresh_token: "refresh" }));
    const openExternal = vi.fn(async (authUrl: string) => {
      const url = new URL(authUrl);
      await fetch(`${url.searchParams.get("redirect_uri")}?code=abc&state=${url.searchParams.get("state")}`);
    });
    await expect(google.signIn({ clientId: "id", openExternal, fetchImpl })).resolves.toBe("refresh");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(init.body).toContain("code=abc");
    expect(init.body).toContain("code_verifier=");
  });

  it("refuses a redirect with the wrong state", async () => {
    const openExternal = vi.fn(async (authUrl: string) => {
      const url = new URL(authUrl);
      await fetch(`${url.searchParams.get("redirect_uri")}?code=abc&state=wrong`);
    });
    await expect(google.signIn({ clientId: "id", openExternal, fetchImpl: vi.fn() })).rejects.toThrow("did not match");
  });

  it("reads events and skips cancelled ones, following pages", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ items: [{ id: "1", summary: "Site visit", start: { dateTime: "2026-11-02T10:00:00-06:00" }, end: { dateTime: "2026-11-02T11:00:00-06:00" } }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(json({ items: [{ id: "2", status: "cancelled" }, { id: "3", start: { date: "2026-11-03" } }] }));
    const events = await google.listEvents({ token: "t", calendarId: "a@b", from: "2026-11-01", to: "2026-11-30", fetchImpl });
    expect(events.map((event: { id: string }) => event.id)).toEqual(["1", "3"]);
    expect(events[1]).toMatchObject({ name: "Busy", date: "2026-11-03", date_end: null });
  });

  it("keeps Google's response out of error messages", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "secret detail" }, false, 401));
    await expect(google.accessToken({ clientId: "id", refreshToken: "r", fetchImpl })).rejects.toThrow("status 401");
  });
});
