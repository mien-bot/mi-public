"use client";

import { useEffect } from "react";
import {
  applyThemeToDocument,
  readStoredThemePreference,
  THEME_PREFERENCE_EVENT,
} from "@/lib/theme/preferences";

/**
 * Set on <html> while the window is hidden. app/globals.css resolves
 * `--mi-ambient-play` to `paused` under this class and additionally pauses the
 * pre-existing infinite animations (the chat typing dots, the loading mark, the
 * data-flow dashes), none of which anyone can see while the window is in the
 * background.
 */
const HIDDEN_WINDOW_CLASS = "mi-window-hidden";

/**
 * Keeps the appearance preference live after the page has hydrated:
 *
 * - Re-syncs on mount (defense in depth alongside the blocking bootstrap
 *   script inlined in app/layout.tsx's <head>, which already applied the
 *   preference before hydration to avoid a flash of the wrong theme).
 * - Listens for OS light/dark changes via matchMedia, so System mode stays
 *   responsive to a live OS change without a reload.
 * - Listens for the `storage` event (fires in other tabs/windows) and the
 *   same-tab `mi-theme-preference-changed` custom event (fires when
 *   components/AppearanceSettings.tsx writes a new preference), so every
 *   open tab converges on the same appearance.
 * - Marks the document `mi-window-hidden` whenever the window is not visible,
 *   which parks every looping animation in app/globals.css (see
 *   HIDDEN_WINDOW_CLASS below). Nothing about this is visible to the user —
 *   it exists so a backgrounded Mi window stops asking the compositor for
 *   frames it will never paint.
 *
 * Renders nothing — this is a behavior-only component, mounted once in the
 * root layout.
 */
export function ThemeProvider() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function sync() {
      const preference = readStoredThemePreference(window.localStorage);
      applyThemeToDocument(preference, media.matches);
    }

    sync();

    function syncVisibility() {
      document.documentElement.classList.toggle(HIDDEN_WINDOW_CLASS, document.hidden);
    }

    syncVisibility();

    media.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    window.addEventListener(THEME_PREFERENCE_EVENT, sync);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener(THEME_PREFERENCE_EVENT, sync);
      document.removeEventListener("visibilitychange", syncVisibility);
      // A remount must never leave the document parked with animations paused.
      document.documentElement.classList.remove(HIDDEN_WINDOW_CLASS);
    };
  }, []);

  return null;
}
