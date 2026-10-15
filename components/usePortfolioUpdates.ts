"use client";
import { useEffect, useState } from "react";
import type { ProjectDiscovery } from "@/lib/content/projectDiscoveryTypes";
import { markProjectSeen, parseSeenProject, projectUpdates } from "./projectUpdates";

export function usePortfolioUpdates(slugs: string[]) {
  const [updates, setUpdates] = useState<Record<string, { count: number; label: string; observedAt: number }>>({});
  const [errors, setErrors] = useState(0);
  const [scanVersion, setScanVersion] = useState(0);
  const slugKey = slugs.join(",");
  useEffect(() => {
    const controller = new AbortController();
    const snapshots = new Map<string, ProjectDiscovery>();
    const queue = slugKey.split(",").filter(Boolean);
    let failures = 0;
    function update() {
      const values: Record<string, { count: number; label: string; observedAt: number }> = {};
      for (const [slug, data] of snapshots) {
        try {
          const key = `mi:project-seen:v1:${slug}`;
          let seen = parseSeenProject(localStorage.getItem(key));
          if (!seen) { seen = markProjectSeen(data.changes, null); localStorage.setItem(key, JSON.stringify(seen)); }
          const changed = projectUpdates(data.changes, seen, data.complete, `/projects/${slug}/activity`);
          const observedKey = `mi:project-observed:v1:${slug}`;
          const signature = JSON.stringify(changed.map(c => [c.id, c.revision]).sort());
          let observed: { signature?: string; at?: number } = {};
          try { observed = JSON.parse(localStorage.getItem(observedKey) || "{}"); } catch { /* Rebuild invalid device metadata. */ }
          if (observed?.signature !== signature) { observed = { signature, at: Date.now() }; localStorage.setItem(observedKey, JSON.stringify(observed)); }
          values[slug] = { count: changed.length, label: changed[0]?.label ?? "", observedAt: changed.length ? observed?.at ?? 0 : 0 };
        } catch { /* Unread status cannot be persisted on this device. */ }
      }
      if (!controller.signal.aborted) setUpdates(values);
    }
    async function worker() {
      while (queue.length && !controller.signal.aborted) {
        const slug = queue.shift()!;
        try {
          const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/discovery${scanVersion ? "?refresh=1" : ""}`, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) throw new Error("Unavailable");
          snapshots.set(slug, await response.json()); update();
        } catch { if (!controller.signal.aborted) { failures++; setErrors(failures); } }
      }
    }
    void worker(); void worker();
    window.addEventListener("storage", update); window.addEventListener("mi:project-seen", update);
    return () => { controller.abort(); window.removeEventListener("storage", update); window.removeEventListener("mi:project-seen", update); };
  }, [slugKey, scanVersion]);
  return { updates, errors, refresh: () => setScanVersion(value => value + 1) };
}
