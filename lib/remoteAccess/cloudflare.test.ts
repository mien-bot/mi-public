import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticateCloudflareAccess,
  clearRemoteAccessKeyCacheForTests,
} from "./cloudflare";
import type { RemoteAccessConfig } from "./config";

const config: RemoteAccessConfig = {
  enabled: true,
  hostname: "mi.studio.work",
  teamDomain: "https://studio.cloudflareaccess.com",
  audience: "mi-audience",
  allowedEmails: new Set(["user@example.com"]),
};

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString("base64url");
}

async function fixture(overrides: Record<string, unknown> = {}, kid = "test-key") {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const header = base64Url(JSON.stringify({ alg: "RS256", kid }));
  const payload = base64Url(JSON.stringify({
    aud: config.audience,
    email: "user@example.com",
    exp: 2_000_000_000,
    iss: config.teamDomain,
    ...overrides,
  }));
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  ));
  return {
    token: `${header}.${payload}.${base64Url(signature)}`,
    fetchImplementation: vi.fn(async () => new Response(JSON.stringify({
      keys: [{ ...publicKey, kid, alg: "RS256", use: "sig" }],
    }), { status: 200 })) as unknown as typeof fetch,
  };
}

afterEach(() => {
  clearRemoteAccessKeyCacheForTests();
});

describe("Cloudflare Access authentication", () => {
  it("refreshes signing keys on rotation and bounds unknown-key refetches", async () => {
    const old = await fixture({}, "old-key"), rotated = await fixture({}, "rotated-key");
    const headers = (token: string) => new Headers({ "cf-access-jwt-assertion": token, "cf-access-authenticated-user-email": "user@example.com" });
    await authenticateCloudflareAccess(headers(old.token), config, { fetchImplementation: old.fetchImplementation, now: 1_900_000_000_000 });
    await expect(authenticateCloudflareAccess(headers(rotated.token), config, { fetchImplementation: rotated.fetchImplementation, now: 1_900_000_031_000 })).resolves.toEqual({ email: "user@example.com" });
    expect(rotated.fetchImplementation).toHaveBeenCalledOnce();
    await expect(authenticateCloudflareAccess(headers(old.token), config, { fetchImplementation: old.fetchImplementation, now: 1_900_000_032_000 })).rejects.toThrow();
    expect(old.fetchImplementation).toHaveBeenCalledOnce();
  });
  it("rejects wrong issuer/audience, future activation, unauthorized email and altered signatures", async () => {
    for (const claims of [{ iss: "https://other.cloudflareaccess.com" }, { aud: "other" }, { nbf: 2_100_000_000 }, { email: "other@example.com" }]) {
      clearRemoteAccessKeyCacheForTests();
      const signed = await fixture(claims);
      await expect(authenticateCloudflareAccess(new Headers({ "cf-access-jwt-assertion": signed.token, "cf-access-authenticated-user-email": claims.email || "user@example.com" }), config, { fetchImplementation: signed.fetchImplementation, now: 1_900_000_000_000 })).rejects.toThrow();
    }
    clearRemoteAccessKeyCacheForTests();
    const signed = await fixture();
    const segments = signed.token.split(".");
    segments[2] = (segments[2][0] === "A" ? "B" : "A") + segments[2].slice(1);
    await expect(authenticateCloudflareAccess(new Headers({ "cf-access-jwt-assertion": segments.join("."), "cf-access-authenticated-user-email": "user@example.com" }), config, { fetchImplementation: signed.fetchImplementation, now: 1_900_000_000_000 })).rejects.toThrow();
  });
  it("verifies the signature, issuer, audience, expiry, and exact email allowlist", async () => {
    const { token, fetchImplementation } = await fixture();
    const headers = new Headers({
      "cf-access-jwt-assertion": token,
      "cf-access-authenticated-user-email": "user@example.com",
    });
    await expect(authenticateCloudflareAccess(headers, config, {
      fetchImplementation,
      now: 1_900_000_000_000,
    })).resolves.toEqual({ email: "user@example.com" });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("rejects missing headers, expired tokens, and email-header mismatches", async () => {
    await expect(authenticateCloudflareAccess(new Headers(), config)).rejects.toThrow(
      "Remote authentication failed.",
    );

    const expired = await fixture({ exp: 100 });
    await expect(authenticateCloudflareAccess(new Headers({
      "cf-access-jwt-assertion": expired.token,
      "cf-access-authenticated-user-email": "user@example.com",
    }), config, {
      fetchImplementation: expired.fetchImplementation,
      now: 1_900_000_000_000,
    })).rejects.toThrow("Remote authentication failed.");

    clearRemoteAccessKeyCacheForTests();
    const mismatch = await fixture();
    await expect(authenticateCloudflareAccess(new Headers({
      "cf-access-jwt-assertion": mismatch.token,
      "cf-access-authenticated-user-email": "other@example.com",
    }), config, {
      fetchImplementation: mismatch.fetchImplementation,
      now: 1_900_000_000_000,
    })).rejects.toThrow("Remote authentication failed.");
  });
});
