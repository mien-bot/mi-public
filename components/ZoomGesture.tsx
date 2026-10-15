"use client";

import { useEffect } from "react";
import { wheelZoomAction } from "@/lib/zoomGesture";

/**
 * Ctrl/Cmd + mouse wheel (and trackpad pinch) text zoom.
 *
 * The main process already maps the keyboard shortcuts through `before-input-event`, which is
 * reliable. Its `before-mouse-event` companion never actually reached us for wheel events, so
 * the gesture did nothing. Handling it here instead works uniformly: the listener is capturing
 * and non-passive, so it runs before the terminal or any scroll container claims the wheel, and
 * `preventDefault` stops Chromium's own page zoom from fighting the level we set.
 *
 * Renders nothing. Outside the desktop app there is no zoom bridge and this is inert.
 */
export function ZoomGesture() {
  useEffect(() => {
    const zoom = window.electronAPI?.zoom;
    if (!zoom) return;

    function onWheel(event: WheelEvent) {
      if (event.target instanceof Element && event.target.closest("[data-local-wheel-zoom]")) return;
      const action = wheelZoomAction(event);
      if (!action) return;
      event.preventDefault();
      void zoom!.step(action);
    }

    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  return null;
}
