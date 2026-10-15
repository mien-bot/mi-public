import { afterEach, describe, expect, it, vi } from "vitest";
import { projectGrants, requireProjectGrant, requireRemoteReader } from "./access";

afterEach(() => vi.unstubAllEnvs());
describe("remote project grants", () => {
  it("requires an explicit exact grant and never assumes all projects", () => {
    expect(projectGrants("partner@example.com", "{}")).toEqual([]);
    const raw = '{"partner@example.com":["one","one","two"]}';
    expect(projectGrants("partner@example.com", raw)).toEqual(["one", "two"]);
    expect(projectGrants("other@example.com", raw)).toEqual([]);
    vi.stubEnv("MI_REMOTE_PROJECT_GRANTS", raw);
    expect(() => requireProjectGrant({ email: "partner@example.com" }, "three")).toThrow();
    expect(() => requireProjectGrant({ email: "partner@example.com" }, "one")).not.toThrow();
  });
  it("fails closed for wildcards, invalid paths, malformed JSON, and ambiguous email keys", () => {
    for (const raw of ['{"user@example.com":["*"]}', '{"user@example.com":["../private"]}', '{"USER@example.com":["one"]}', '[]', 'broken', '{"user@example.com":"one"}']) expect(() => projectGrants("user@example.com", raw)).toThrow();
  });
  it("requires authentication at the data boundary even on loopback or with a spoofed principal header", async () => {
    vi.stubEnv("MI_REMOTE_ACCESS", "1"); vi.stubEnv("MI_REMOTE_HOSTNAME", "mi.example.com");
    vi.stubEnv("MI_CLOUDFLARE_ACCESS_TEAM_DOMAIN", "https://fixture.cloudflareaccess.com");
    vi.stubEnv("MI_CLOUDFLARE_ACCESS_AUD", "fixture"); vi.stubEnv("MI_REMOTE_ALLOWED_EMAILS", "user@example.com");
    for (const host of ["127.0.0.1", "mi.example.com"]) {
      await expect(requireRemoteReader(new Request("http://localhost/remote", { headers: { host, "x-mi-remote-user": "user@example.com" } }))).rejects.toThrow();
    }
  });
});
