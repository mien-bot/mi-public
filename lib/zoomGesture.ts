export type ZoomAction = "in" | "out";

/**
 * Interprets a DOM wheel event as a text-zoom gesture.
 *
 * Note the sign convention is the opposite of Electron's native wheel input: a DOM `deltaY`
 * is positive when scrolling *down* (zoom out), whereas Electron's `wheelTicksY` is positive
 * when scrolling *up*. Getting this backwards inverts the whole gesture, so it lives in one
 * tested function rather than inline in the listener.
 *
 * `ctrlKey` is true for a pinch gesture on a trackpad as well as a real Ctrl press, which is
 * what makes pinch-to-zoom work for free. metaKey covers Cmd on macOS.
 */
export function wheelZoomAction(event: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  deltaY?: number;
}): ZoomAction | null {
  if (!event.ctrlKey && !event.metaKey) return null;
  const delta = Number(event.deltaY);
  if (!Number.isFinite(delta) || delta === 0) return null;
  return delta < 0 ? "in" : "out";
}
