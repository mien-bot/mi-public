export interface RemoteRouteDecision {
  allowed: boolean;
  reason: "allowed" | "desktop-only" | "api-not-enabled";
}

const DESKTOP_ONLY_PAGE_SEGMENTS = new Set(["onboarding", "settings", "terminal"]);

function hasDesktopOnlySegment(pathname: string): boolean {
  return pathname
    .split("/")
    .filter(Boolean)
    .some((segment) => DESKTOP_ONLY_PAGE_SEGMENTS.has(segment));
}

export function remoteRouteDecision(method: string, pathname: string): RemoteRouteDecision {
  const normalizedMethod = method.toUpperCase();
  if (hasDesktopOnlySegment(pathname)) return { allowed: false, reason: "desktop-only" };
  if ((normalizedMethod === "GET" || normalizedMethod === "HEAD") && (
    pathname === "/" || pathname === "/remote" || pathname === "/api/mobile/status"
    || pathname === "/api/mobile/projects"
    || /^\/api\/mobile\/projects\/[a-z0-9][a-z0-9-]{0,99}(?:\/pdf)?$/.test(pathname)
  )) {
    return { allowed: true, reason: "allowed" };
  }
  return { allowed: false, reason: "api-not-enabled" };
}
