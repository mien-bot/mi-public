"use client";
import { useSyncExternalStore } from "react";
export interface CompanionInboxEntry { kind: string; slug: string; pending: number; failed: number }
const empty = { entries: [] as CompanionInboxEntry[], checkedAt: 0 };
let snapshot = empty;
const listeners = new Set<() => void>();
export function publishCompanionInbox(entries: CompanionInboxEntry[], checkedAt: number) {
  snapshot = { entries, checkedAt }; listeners.forEach(fn => fn());
}
function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function useCompanionInbox() { return useSyncExternalStore(subscribe, () => snapshot, () => empty); }
