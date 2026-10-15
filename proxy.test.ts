import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("remote access proxy", () => {
  it("keeps the dynamic image optimizer behind remote authentication", () => {
    expect(config.matcher.join(" ")).not.toContain("_next/image");
  });

  it("preserves the private Electron loopback origin", async () => {
    const response = await proxy(new NextRequest("http://127.0.0.1:3050/settings"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("hides remote access when it is disabled", async () => {
    vi.stubEnv("MI_REMOTE_ACCESS", "0");
    const response = await proxy(new NextRequest("https://mi.studio.work/projects"));
    expect(response.status).toBe(404);
  });

  it("does not trust loopback when Cloudflare or a remote forwarded host is present", async () => {
    vi.stubEnv("MI_REMOTE_ACCESS", "0");
    const cases: Record<string, string>[] = [{ "cf-connecting-ip": "203.0.113.1" }, { "cf-access-jwt-assertion": "spoof" }, { "x-forwarded-host": "mi.example.com" }];
    for (const headers of cases) {
      const response = await proxy(new NextRequest("http://127.0.0.1:3050/personal", { headers }));
      expect(response.status).toBe(404);
    }
    const local = await proxy(new NextRequest("http://127.0.0.1:3050/settings", { headers: { "x-forwarded-host": "127.0.0.1:3050" } }));
    expect(local.headers.get("x-middleware-next")).toBe("1");
  });

  it("fails closed when enabled configuration is incomplete", async () => {
    vi.stubEnv("MI_REMOTE_ACCESS", "1");
    const response = await proxy(new NextRequest("https://mi.studio.work/projects"));
    expect(response.status).toBe(503);
  });
});
