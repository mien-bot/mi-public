import { describe, expect, it } from "vitest";
import {
  isExpectedRemoteHostname,
  isLoopbackHostname,
  readRemoteAccessConfig,
} from "./config";

describe("remote access configuration", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(readRemoteAccessConfig({})).toBeNull();
    expect(readRemoteAccessConfig({ MI_REMOTE_ACCESS: "0" })).toBeNull();
  });

  it("normalizes one exact remote hostname and an email allowlist", () => {
    const config = readRemoteAccessConfig({
      MI_REMOTE_ACCESS: "1",
      MI_REMOTE_HOSTNAME: "Mi.Studio.Work.",
      MI_CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://studio.cloudflareaccess.com",
      MI_CLOUDFLARE_ACCESS_AUD: "audience-id",
      MI_REMOTE_ALLOWED_EMAILS: "user@example.com, user@example.com",
    });
    expect(config).not.toBeNull();
    expect(config?.hostname).toBe("mi.studio.work");
    expect(config?.allowedEmails).toEqual(new Set(["user@example.com", "user@example.com"]));
    expect(isExpectedRemoteHostname("MI.STUDIO.WORK", config!)).toBe(true);
  });

  it("rejects incomplete, loopback, or non-Cloudflare configuration", () => {
    expect(() => readRemoteAccessConfig({ MI_REMOTE_ACCESS: "1" })).toThrow(/MI_REMOTE_HOSTNAME/);
    expect(() => readRemoteAccessConfig({
      MI_REMOTE_ACCESS: "1",
      MI_REMOTE_HOSTNAME: "127.0.0.1",
    })).toThrow(/non-loopback/);
    expect(() => readRemoteAccessConfig({
      MI_REMOTE_ACCESS: "1",
      MI_REMOTE_HOSTNAME: "mi.studio.work",
      MI_CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://example.com",
      MI_CLOUDFLARE_ACCESS_AUD: "audience-id",
      MI_REMOTE_ALLOWED_EMAILS: "user@example.com",
    })).toThrow(/Cloudflare Access team domain/);
  });

  it("recognizes only explicit loopback hostnames", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1.example.com")).toBe(false);
  });
});
