import { authenticateCloudflareAccess, type RemotePrincipal } from "./cloudflare";
import { isExpectedRemoteHostname, readRemoteAccessConfig } from "./config";

export class RemoteReadError extends Error {
  constructor(public status: number, message = "Remote project access unavailable.") { super(message); }
}

/** Deliberately separate from sign-in: no grant means no project, including future projects. */
export function projectGrants(email: string, raw = process.env.MI_REMOTE_PROJECT_GRANTS): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== "object") throw Error();
    for (const [key, slugs] of Object.entries(value)) {
      if (key !== key.toLowerCase().trim() || !Array.isArray(slugs) || slugs.length > 100
        || slugs.some(slug => typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug))) throw Error();
    }
    return Object.hasOwn(value, email) ? [...new Set<string>(value[email])] : [];
  } catch { throw new RemoteReadError(503, "Remote project permissions need configuration."); }
}

export async function requireRemoteReader(request: Request): Promise<RemotePrincipal> {
  let config;
  try { config = readRemoteAccessConfig(); } catch { throw new RemoteReadError(503); }
  // Next may internally construct request.url using localhost. Host must remain the public
  // hostname through cloudflared; forwarded identity/host headers are never trusted here.
  const host = request.headers.get("host") || "";
  if (!config || !isExpectedRemoteHostname(host, config)) throw new RemoteReadError(404);
  if (request.method !== "GET" && request.method !== "HEAD") throw new RemoteReadError(405);
  try { return await authenticateCloudflareAccess(request.headers, config); }
  catch { throw new RemoteReadError(401, "Sign in through the Mi Cloudflare Access address."); }
}

export function requireProjectGrant(principal: RemotePrincipal, slug: string) {
  if (!projectGrants(principal.email).includes(slug)) throw new RemoteReadError(404);
}

export const remoteHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export function remoteFailure(error: unknown) {
  const known = error instanceof RemoteReadError;
  return Response.json({ error: known ? error.message : "Project data is unavailable on the host. Try again later." },
    { status: known ? error.status : 503, headers: remoteHeaders });
}
