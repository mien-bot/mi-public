"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isPaneWindowRoute } from "@/components/workspacePanes";

const ALWAYS_ALLOWED = new Set(["/onboarding", "/settings"]);

/**
 * Keeps a fresh install from landing on the main dashboard or a deep link before the
 * minimum required config (Dropbox root + Notion token) exists. /settings stays reachable
 * during setup too, since PartnerSetup covers flows (legacy .env import, diagnostics
 * export) the onboarding wizard intentionally doesn't duplicate.
 *
 * A pop-out card window is exempt. A card is a frameless, always-on-top window whose only
 * chrome is the titlebar its own route draws, so replacing that route with the setup wizard
 * produces a window pinned above everything with no way to close it -- the exact failure this
 * guard is not meant to cause. The wizard belongs in the main window, which is gated already.
 */
export function OnboardingGuard() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const api = window.electronAPI?.setup;
    if (!api) return;
    let cancelled = false;
    api.get().then(({ config }) => {
      if (cancelled) return;
      if (!config.setupCompleted && !ALWAYS_ALLOWED.has(pathname) && !isPaneWindowRoute(pathname)) {
        router.replace("/onboarding");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
