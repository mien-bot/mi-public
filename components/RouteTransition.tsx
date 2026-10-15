"use client";

import { usePathname } from "next/navigation";
import { isPaneWindowRoute } from "@/components/workspacePanes";

/**
 * Keyed by pathname so React remounts this div (replaying the CSS
 * `fade-in-up` animation) on every route change — no routing library,
 * no animation library, just a keyed element. See app/globals.css for the
 * keyframe (gated on prefers-reduced-motion).
 *
 * The home route ("/") is a special case: ChatWidget (a layout-level sibling of
 * this component, so its mounted state persists across navigation) fully owns
 * that route's visible content once it hydrates -- see its `isHome` branch. Left
 * to itself, Next.js still renders app/page.tsx's server output here regardless
 * of ChatWidget's state, which used to permanently show a stale "Loading chat…"
 * placeholder above the real, already-hydrated chat. Suppressing children here
 * for "/" is what actually makes ChatWidget's full-page takeover real.
 */
export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return null;
  // A pop-out card window is not a page transition, and the wrapper below would break it:
  // while `route-enter` runs, its transform and filter make the wrapper the containing block
  // for the card's `position: fixed` surface, which collapses the card into the wrapper's own
  // zero-height box. See isPaneWindowRoute, and the fill-mode note in app/globals.css.
  if (isPaneWindowRoute(pathname)) return <>{children}</>;
  return (
    <div key={pathname} className="animate-route-enter">
      {children}
    </div>
  );
}
