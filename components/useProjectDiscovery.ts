"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDiscovery } from "@/lib/content/projectDiscoveryTypes";
export const DISCOVERY_CHANGED = "mi:project-discovery-changed";
export function useProjectDiscovery(slug: string) {
  const [data, setData] = useState<ProjectDiscovery | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async (force = false, signal?: AbortSignal) => {
    const requestId = ++sequence.current;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/discovery${force ? "?refresh=1" : ""}`, { signal, cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Project files unavailable.");
      if (!signal?.aborted && requestId === sequence.current) { setData(value); setError(""); }
    } catch (cause) { if (!signal?.aborted && requestId === sequence.current) setError(cause instanceof Error ? cause.message : "Could not load project files."); }
    finally { if (!signal?.aborted && requestId === sequence.current) setBusy(false); }
  }, [slug]);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void refresh(false, controller.signal); });
    const changed = () => void refresh(false, controller.signal);
    window.addEventListener(DISCOVERY_CHANGED, changed);
    window.addEventListener("focus", changed);
    return () => { controller.abort(); window.removeEventListener(DISCOVERY_CHANGED, changed); window.removeEventListener("focus", changed); };
  }, [refresh]);
  return { data: data?.slug === slug ? data : null, error, busy, refresh };
}
