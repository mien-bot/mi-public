import type { RemoteAccessConfig } from "./config";

interface CloudflareAccessClaims {
  aud?: string | string[];
  email?: string;
  exp?: number;
  iss?: string;
  nbf?: number;
}

interface JsonWebKeySet {
  keys?: CloudflareJsonWebKey[];
}

interface CloudflareJsonWebKey extends JsonWebKey {
  kid?: string;
}

interface CachedKeySet {
  expiresAt: number;
  fetchedAt: number;
  keys: CloudflareJsonWebKey[];
}

export interface RemotePrincipal {
  email: string;
}

export class RemoteAccessAuthenticationError extends Error {
  constructor(message = "Remote authentication failed.") {
    super(message);
    this.name = "RemoteAccessAuthenticationError";
  }
}

const jwksCache = new Map<string, CachedKeySet>();
const jwksPending = new Map<string, Promise<CloudflareJsonWebKey[]>>();
const JWKS_CACHE_MS = 5 * 60 * 1000;

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    throw new RemoteAccessAuthenticationError();
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return bytes.buffer;
}

function decodeJson<T>(value: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
  } catch {
    throw new RemoteAccessAuthenticationError();
  }
}

function normalizedIssuer(value: string): string {
  return value.replace(/\/+$/, "");
}

async function fetchKeySet(
  teamDomain: string,
  fetchImplementation: typeof fetch,
  now: number,
  refresh = false,
): Promise<CloudflareJsonWebKey[]> {
  const endpoint = new URL("/cdn-cgi/access/certs", teamDomain).toString();
  const cached = jwksCache.get(endpoint);
  if (cached && cached.expiresAt > now && (!refresh || now - cached.fetchedAt < 30_000)) return cached.keys;
  const pending = jwksPending.get(endpoint);
  if (pending) return pending;

  const load = (async () => {

  let response: Response;
  try {
    response = await fetchImplementation(endpoint, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new RemoteAccessAuthenticationError();
  }
  if (!response.ok) throw new RemoteAccessAuthenticationError();
  const parsed = await response.json().catch(() => null) as JsonWebKeySet | null;
  if (!Array.isArray(parsed?.keys) || !parsed.keys.length || parsed.keys.length > 20) throw new RemoteAccessAuthenticationError();
  jwksCache.set(endpoint, { keys: parsed.keys, fetchedAt: now, expiresAt: now + JWKS_CACHE_MS });
  return parsed.keys;
  })();
  jwksPending.set(endpoint, load);
  try { return await load; } finally { jwksPending.delete(endpoint); }
}

function audienceMatches(claim: string | string[] | undefined, expected: string): boolean {
  return typeof claim === "string" ? claim === expected : Array.isArray(claim) && claim.includes(expected);
}

export async function authenticateCloudflareAccess(
  headers: Headers,
  config: RemoteAccessConfig,
  {
    fetchImplementation = fetch,
    now = Date.now(),
  }: { fetchImplementation?: typeof fetch; now?: number } = {},
): Promise<RemotePrincipal> {
  const token = headers.get("cf-access-jwt-assertion")?.trim();
  const assertedEmail = headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
  if (!token || token.length > 16_384 || !assertedEmail) throw new RemoteAccessAuthenticationError();

  const segments = token.split(".");
  if (segments.length !== 3) throw new RemoteAccessAuthenticationError();
  const header = decodeJson<{ alg?: string; kid?: string }>(segments[0]);
  const claims = decodeJson<CloudflareAccessClaims>(segments[1]);
  if (header.alg !== "RS256" || !header.kid) throw new RemoteAccessAuthenticationError();

  let keys = await fetchKeySet(config.teamDomain, fetchImplementation, now);
  if (!keys.some(candidate => candidate.kid === header.kid)) keys = await fetchKeySet(config.teamDomain, fetchImplementation, now, true);
  const jwk = keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA" && (!candidate.alg || candidate.alg === "RS256") && (!candidate.use || candidate.use === "sig"));
  if (!jwk) throw new RemoteAccessAuthenticationError();

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    throw new RemoteAccessAuthenticationError();
  }
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(segments[2]),
    new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
  );
  if (!verified) throw new RemoteAccessAuthenticationError();

  const nowSeconds = Math.floor(now / 1000);
  const email = claims.email?.trim().toLowerCase();
  if (
    !email
    || email !== assertedEmail
    || !config.allowedEmails.has(email)
    || !audienceMatches(claims.aud, config.audience)
    || normalizedIssuer(claims.iss || "") !== normalizedIssuer(config.teamDomain)
    || typeof claims.exp !== "number"
    || claims.exp <= nowSeconds
    || (typeof claims.nbf === "number" && claims.nbf > nowSeconds)
  ) {
    throw new RemoteAccessAuthenticationError();
  }
  return { email };
}

export function clearRemoteAccessKeyCacheForTests(): void {
  jwksCache.clear();
  jwksPending.clear();
}
