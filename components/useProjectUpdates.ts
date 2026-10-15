"use client";
import { useCallback, useEffect, useState } from "react";
import type { ProjectChange } from "@/lib/content/projectDiscoveryTypes";
import { markProjectSeen, parseSeenProject, projectUpdates, type SeenProject } from "./projectUpdates";
const EVENT = "mi:project-seen";
export function useProjectUpdates(slug: string, changes?: ProjectChange[], complete = false) {
  const [seen, setSeen] = useState<SeenProject | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const key = `mi:project-seen:v1:${slug}`;
  useEffect(() => {
    const restore = () => {
      try {
        let saved = parseSeenProject(localStorage.getItem(key));
        if (!saved && changes) { saved = markProjectSeen(changes, null); localStorage.setItem(key, JSON.stringify(saved)); }
        setSeen(saved);
      } catch { setStorageAvailable(false); }
    };
    restore(); window.addEventListener("storage", restore); window.addEventListener(EVENT, restore);
    return () => { window.removeEventListener("storage", restore); window.removeEventListener(EVENT, restore); };
  }, [key, changes]);
  const markReviewed = useCallback(() => {
    if (!changes) return;
    try { const previous = parseSeenProject(localStorage.getItem(key)); const displayed = projectUpdates(changes, previous, complete); const value = markProjectSeen([...changes, ...displayed], previous); localStorage.setItem(key, JSON.stringify(value)); setSeen(value); window.dispatchEvent(new Event(EVENT)); }
    catch { setStorageAvailable(false); }
  }, [changes, complete, key]);
  return { updates: projectUpdates(changes ?? [], seen, complete, `/projects/${slug}/activity`), markReviewed, storageAvailable };
}
