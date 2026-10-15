"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { DEFAULT_MINI_MI, readMiniMiPreference } from "./preferences";
import { subscribeToThemePreference, useThemeMotion } from "./useThemeMotion";

export const MINI_MI_ACTIVITIES = ["idle", "thinking", "working", "looking", "bored", "eating", "drafting", "waving", "dancing", "jumping", "singing", "breakdancing", "spinning", "sleeping", "walking", "angry", "sad", "happy"] as const;
export type MiniMiActivity = typeof MINI_MI_ACTIVITIES[number];

function stored() {
  try { return readMiniMiPreference(window.localStorage); }
  catch { return DEFAULT_MINI_MI; }
}
const character = () => stored().character;
const animations = () => stored().animations;
const behavior = () => stored().behavior;
const size = () => stored().size;
const snoozedUntil = () => stored().snoozedUntil;
const favorites = () => stored().favorites.join(",");
const serverCharacter = () => DEFAULT_MINI_MI.character;
const serverAnimations = () => DEFAULT_MINI_MI.animations;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverReduced = () => true;
function subscribeReduced(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function useMiniMiPreference() {
  const selected = useSyncExternalStore(subscribeToThemePreference, character, serverCharacter);
  const animated = useSyncExternalStore(subscribeToThemePreference, animations, serverAnimations);
  const selectedBehavior = useSyncExternalStore(subscribeToThemePreference, behavior, () => DEFAULT_MINI_MI.behavior);
  const selectedSize = useSyncExternalStore(subscribeToThemePreference, size, () => DEFAULT_MINI_MI.size);
  const snooze = useSyncExternalStore(subscribeToThemePreference, snoozedUntil, () => 0);
  const favoriteList = useSyncExternalStore(subscribeToThemePreference, favorites, () => DEFAULT_MINI_MI.favorites.join(","));
  return { character: selected, animations: animated, behavior: selectedBehavior, size: selectedSize, snoozedUntil: snooze,
    favorites: favoriteList ? favoriteList.split(",") as typeof DEFAULT_MINI_MI.favorites : [] };
}

export function useMiniMiMotion() {
  const { animations: enabled } = useMiniMiPreference();
  const motion = useThemeMotion();
  const reduce = useSyncExternalStore(subscribeReduced, reduced, serverReduced);
  return enabled && motion !== "minimal" && !reduce;
}

// Brief idle vignettes, separated by quiet intervals. Work poses need a pending reply.
export const MINI_MI_IDLE_SEQUENCE: readonly [MiniMiActivity, number][] = [
  ["idle", 24000], ["looking", 4000], ["idle", 24000], ["drafting", 6000],
  ["idle", 30000], ["bored", 6000], ["idle", 24000], ["eating", 6000],
];
const BUSY_SEQUENCE: readonly [MiniMiActivity, number][] = [["thinking", 6000], ["working", 6000], ["drafting", 6000]];

export function useMiniMiActivity(pending: boolean): MiniMiActivity {
  const enabled = useMiniMiMotion();
  const { behavior } = useMiniMiPreference();
  const ambient = enabled && behavior === "playful";
  const [frame, setFrame] = useState<{ pending: boolean; activity: MiniMiActivity }>({ pending: false, activity: "idle" });
  useEffect(() => {
    if (!enabled || (!pending && !ambient)) return;
    let timer: ReturnType<typeof setTimeout>;
    let step = 0;
    const sequence = pending ? BUSY_SEQUENCE : MINI_MI_IDLE_SEQUENCE;
    function tick() {
      if (document.hidden) return;
      const [activity, duration] = sequence[step];
      setFrame({ pending, activity });
      step = (step + 1) % sequence.length;
      timer = setTimeout(tick, duration);
    }
    function restart() {
      clearTimeout(timer);
      step = 0;
      timer = setTimeout(tick, 0);
    }
    function visibility() {
      clearTimeout(timer);
      if (!document.hidden) restart();
    }
    restart();
    document.addEventListener("visibilitychange", visibility);
    if (!pending) {
      window.addEventListener("pointerdown", restart, { passive: true });
      window.addEventListener("keydown", restart);
    }
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointerdown", restart);
      window.removeEventListener("keydown", restart);
    };
  }, [enabled, pending, ambient]);
  if (!enabled || (!pending && !ambient)) return "idle";
  return frame.pending === pending ? frame.activity : pending ? "thinking" : "idle";
}
