"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  clampLauncherPoint,
  exceedsDragThreshold,
  launcherOffset,
  readStoredLauncherPosition,
  snapLauncherPosition,
  writeStoredLauncherPosition,
  type LauncherPosition,
} from "./chatLauncherPosition";

const FALLBACK_BUBBLE_SIZE = { width: 48, height: 48 };

/**
 * Makes the collapsed Talk to Mi bubble something you can pick up and park where you want.
 *
 * Two rules keep it from getting in its own way. A gesture under the drag threshold is still
 * a click, so the bubble opens chat as it always did -- only a real move suppresses that.
 * And an untouched bubble carries no inline position at all: it keeps the CSS corner (with
 * its safe-area insets) until the first drag, so nothing changes for someone who never
 * drags it. Geometry lives in chatLauncherPosition.ts.
 *
 * The gesture tracks on `window` rather than through setPointerCapture, which looks like the
 * obvious tool here and is the wrong one: a captured pointer retargets the resulting click
 * to the capturing element, so the button inside stops receiving it and the bubble no longer
 * opens chat. Window listeners keep the drag working past the edge of a 48px target while
 * leaving the click exactly where it was.
 */
export function ChatLauncherDock({ children, onDragStart }: { children: ReactNode; onDragStart?: () => void }) {
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<LauncherPosition | null>(null);
  /** Live pixel spot while a drag is in flight; null whenever the bubble is at rest. */
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  /** Null until mounted, which is also what keeps the un-dragged bubble on its CSS corner. */
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const [box, setBox] = useState(FALLBACK_BUBBLE_SIZE);
  const suppressClick = useRef(false);
  const detachGesture = useRef<(() => void) | null>(null);

  useEffect(() => {
    const rect = dockRef.current?.getBoundingClientRect();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage and layout are only readable after hydration
    setPosition(readStoredLauncherPosition(window.localStorage));
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    if (rect && rect.width > 0) setBox({ width: rect.width, height: rect.height });

    function handleResize() {
      // The stored vertical fraction re-resolves against the new size on the next render,
      // so the bubble keeps its relative spot instead of drifting off a smaller window.
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }

    window.addEventListener("resize", handleResize);
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.target.getBoundingClientRect();
      if (rect) setBox({ width: rect.width, height: rect.height });
    });
    if (dockRef.current) observer.observe(dockRef.current);
    function reset() { setPosition(null); setDrag(null); }
    window.addEventListener("mi-launcher-reset", reset);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mi-launcher-reset", reset);
      observer.disconnect();
      detachGesture.current?.();
    };
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Left button, touch, or pen only -- a right-click is a context menu, not a grab.
    if (event.button !== 0) return;
    const rect = dockRef.current?.getBoundingClientRect();
    if (!rect) return;

    const pointerId = event.pointerId;
    const grabX = event.clientX - rect.left;
    const grabY = event.clientY - rect.top;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    const liveGeometry = () => ({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      box: dockRef.current?.getBoundingClientRect() ?? FALLBACK_BUBBLE_SIZE,
    });

    const pointFrom = (nativeEvent: PointerEvent) => {
      const { viewport: live, box: liveBox } = liveGeometry();
      return {
        point: clampLauncherPoint(
          { left: nativeEvent.clientX - grabX, top: nativeEvent.clientY - grabY },
          live,
          liveBox,
        ),
        viewport: live,
        box: liveBox,
      };
    };

    function onMove(nativeEvent: PointerEvent) {
      if (nativeEvent.pointerId !== pointerId) return;
      if (!moved && !exceedsDragThreshold(nativeEvent.clientX - startX, nativeEvent.clientY - startY)) return;
      if (!moved) onDragStart?.();
      moved = true;
      setDrag(pointFrom(nativeEvent).point);
    }

    function onEnd(nativeEvent: PointerEvent) {
      if (nativeEvent.pointerId !== pointerId) return;
      detach();
      if (!moved) {
        setDrag(null);
        return;
      }
      // A drag that happens to end over the bubble would otherwise fire a click and open chat.
      suppressClick.current = true;
      const { point, viewport: live, box: liveBox } = pointFrom(nativeEvent);
      const snapped = snapLauncherPosition(point, live, liveBox);
      setPosition(snapped);
      setViewport(live);
      setDrag(null);
      writeStoredLauncherPosition(window.localStorage, snapped);
    }

    function detach() {
      detachGesture.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    }

    detachGesture.current?.();
    detachGesture.current = detach;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }, [onDragStart]);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const resting = position && viewport ? launcherOffset(position, viewport, box) : null;
  const resolved = drag ?? resting;

  return (
    <div
      ref={dockRef}
      onPointerDown={handlePointerDown}
      onClickCapture={handleClickCapture}
      style={resolved ? { left: `${resolved.left}px`, top: `${resolved.top}px`, right: "auto", bottom: "auto" } : undefined}
      className={`mi-chat-launcher fixed z-50 touch-none sm:bottom-6 sm:right-6 ${
        drag ? "mi-chat-launcher-dragging" : "mi-chat-launcher-settling"
      }`}
      title="Drag to move · click to open"
    >
      {children}
    </div>
  );
}
