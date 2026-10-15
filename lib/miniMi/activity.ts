"use client";

import { useSyncExternalStore } from "react";

export type MiActivityState = "running" | "review" | "finished" | "attention" | "stopped" | "saved";
export interface MiActivity { id: string; scope: string; label: string; href: string; state: MiActivityState; updatedAt: number }
const EMPTY: readonly MiActivity[] = [];
let entries: readonly MiActivity[] = EMPTY;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;
let initialized = false;
const stopRequests = new Set<string>();
const states = ["running", "review", "finished", "attention", "stopped", "saved"];

export function validMiActivity(value: unknown): value is MiActivity {
  if (!value || typeof value !== "object") return false;
  const item = value as MiActivity;
  return typeof item.id === "string" && item.id.length <= 180 && typeof item.scope === "string" &&
    /^(studio|personal|leads|permit-qaqc|projects\/[a-z0-9-]+|leads\/[a-z0-9-]+)$/.test(item.scope) &&
    typeof item.label === "string" && item.label.length <= 100 && typeof item.href === "string" &&
    /^\/(?:$|personal$|leads(?:\/[a-z0-9-]+\/chat)?$|permit-qaqc$|projects\/[a-z0-9-]+(?:\?project=[a-z0-9-]+)?$)/.test(item.href) &&
    states.includes(item.state) && Number.isFinite(item.updatedAt);
}

function receive(item: MiActivity) {
  const existing = entries.find(entry => entry.id === item.id);
  if (existing && existing.updatedAt >= item.updatedAt) return;
  entries = [item, ...entries.filter(entry => entry.id !== item.id)].sort((a,b) => b.updatedAt - a.updatedAt).slice(0, 30);
  listeners.forEach(listener => listener());
}
function connect() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  if (typeof BroadcastChannel === "undefined") return;
  try { channel = new BroadcastChannel("mi-companion-activity-v1"); }
  catch { return; } // Companion delivery must never block the actual request.
  channel.onmessage = event => {
    if (event.data === "snapshot") { entries.forEach(broadcast); return; }
    if (validMiActivity(event.data)) receive(event.data);
  };
  broadcast("snapshot");
}
function broadcast(item: MiActivity | "snapshot") {
  try { channel?.postMessage(item); } catch { /* Local activity remains available. */ }
}
export function requestMiActivityStop(id: string) { if (entries.some(item => item.id === id)) stopRequests.add(id); }
export function reportMiActivity(item: Omit<MiActivity, "updatedAt">) {
  connect();
  const entry = { ...item, updatedAt: Math.max(Date.now(), (entries.find(entry => entry.id === item.id)?.updatedAt ?? 0) + 1) };
  if (!validMiActivity(entry)) return;
  receive(entry);
  broadcast(entry);
}
export function finishMiActivity(id: string, state: MiActivityState) {
  const current = entries.find(entry => entry.id === id);
  const stopped = stopRequests.delete(id);
  if (current) reportMiActivity({ ...current, state: stopped ? "stopped" : state });
}
function subscribe(listener: () => void) { connect(); listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useMiActivities() { return useSyncExternalStore(subscribe, () => entries, () => EMPTY); }

export function visibleMiActivities(items: readonly MiActivity[], pathname: string) {
  const privateView = /^\/personal(?:\/|$)/.test(pathname);
  return items.filter(item => privateView ? item.scope === "personal" : item.scope !== "personal");
}
export const MI_ACTIVITY_LABELS: Record<MiActivityState, string> = {
  running: "Preparing a response", review: "Draft ready for review", finished: "Response ready",
  attention: "Needs attention", stopped: "Response stopped", saved: "Confirmed and saved",
};
