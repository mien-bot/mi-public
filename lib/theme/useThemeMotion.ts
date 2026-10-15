"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_THEME_MOTION,
  readStoredThemePreference,
  THEME_PREFERENCE_EVENT,
  type ThemeMotion,
} from "@/lib/theme/preferences";

/**
 * The live Motion level, for the two components that cannot express their motion in CSS
 * alone — components/PersonalKnowledgeGraph.tsx and components/DataFlowMap.tsx, whose
 * positions come out of a JavaScript simulation rather than a stylesheet.
 *
 * Everything else in the app reads the level through CSS instead, off the
 * `data-mi-motion` attribute and the `--mi-ambient-play` switch it resolves (see the
 * "Ambient motion" block in app/globals.css). Prefer that: it costs no client JavaScript
 * and cannot desynchronize from the attribute.
 *
 * The subscription mirrors components/AppearanceSettings.tsx exactly — `storage` for other
 * windows, THEME_PREFERENCE_EVENT for this one — so a change in Settings reaches an open
 * analysis page immediately, without a reload.
 */
export function subscribeToThemePreference(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(THEME_PREFERENCE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(THEME_PREFERENCE_EVENT, onStoreChange);
  };
}

const getStoredMotion = (): ThemeMotion => readStoredThemePreference(window.localStorage).motion;

// Server render (and the first client render, before hydration finishes) uses the
// documented default rather than reading storage, which keeps the two passes identical.
const getServerMotion = (): ThemeMotion => DEFAULT_THEME_MOTION;

export function useThemeMotion(): ThemeMotion {
  return useSyncExternalStore(subscribeToThemePreference, getStoredMotion, getServerMotion);
}

/**
 * Whether continuous, never-ending motion is wanted right now: Cinematic, and only when
 * the OS has not asked for reduced motion. The OS preference is checked live rather than
 * captured once, so toggling it in Windows settings takes effect without a reload.
 *
 * This is the JavaScript twin of CSS's `--mi-ambient-play`, and must stay in step with it.
 */
export function useAmbientMotionEnabled(): boolean {
  const motion = useThemeMotion();
  const reduced = useSyncExternalStore(subscribeToReducedMotion, getReducedMotion, getServerReducedMotion);
  return motion === "cinematic" && !reduced;
}

function subscribeToReducedMotion(onStoreChange: () => void): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

const getReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const getServerReducedMotion = (): boolean => false;
