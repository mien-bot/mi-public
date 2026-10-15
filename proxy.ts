import { NextResponse, type NextRequest } from "next/server";
import { authenticateCloudflareAccess } from "@/lib/remoteAccess/cloudflare";
import {
  isExpectedRemoteHostname,
  isLoopbackHostname,
  readRemoteAccessConfig,
} from "@/lib/remoteAccess/config";
import { remoteRouteDecision } from "@/lib/remoteAccess/policy";

function denied(request: NextRequest, status: number, code: string): Response {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: code }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
  return new NextResponse("This Mi capability is unavailable from the remote web app.", {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

export async function proxy(request: NextRequest): Promise<Response> {
  const rawHost = request.headers.get("host");
  let hostname = "";
  try { hostname = new URL(`http://${rawHost || request.nextUrl.host}`).hostname; } catch { return denied(request, 400, "invalid_host"); }
  // Tunnel-origin mistakes must not turn a forwarded request into trusted desktop traffic.
  const forwardedHost = request.headers.get("x-forwarded-host");
  let forwardedLoopback = !forwardedHost;
  try { if (forwardedHost) forwardedLoopback = isLoopbackHostname(new URL(`http://${forwardedHost}`).hostname); } catch { /* deny malformed forwarded host */ }
  if (isLoopbackHostname(hostname) && !request.headers.has("cf-access-jwt-assertion")
    && !request.headers.has("cf-connecting-ip") && forwardedLoopback) return NextResponse.next();

  let remoteConfig;
  try {
    remoteConfig = readRemoteAccessConfig();
  } catch {
    return denied(request, 503, "remote_access_misconfigured");
  }
  if (!remoteConfig || !isExpectedRemoteHostname(hostname, remoteConfig)) {
    return denied(request, 404, "remote_access_disabled");
  }

  let principal;
  try {
    principal = await authenticateCloudflareAccess(request.headers, remoteConfig);
  } catch {
    return denied(request, 401, "remote_authentication_required");
  }

  const decision = remoteRouteDecision(request.method, request.nextUrl.pathname);
  if (!decision.allowed) return denied(request, 403, decision.reason);

  if (request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/remote", `https://${remoteConfig.hostname}`));
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-mi-remote-user", principal.email);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|icons/|favicon.ico|manifest.webmanifest).*)",
  ],
};
