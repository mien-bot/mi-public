/**
 * Where the collapsed Talk to Mi bubble sits, and how a drag resolves into that.
 *
 * The bubble is draggable anywhere on screen but always comes to rest against the left or
 * right edge: a bubble parked mid-screen covers whatever is under it, and one released near
 * a corner while the window is small would otherwise be pushed off-screen the next time the
 * window grows. Storing the vertical spot as a *fraction* of the usable height rather than a
 * pixel offset is what makes it survive a resize -- a bubble dropped two-thirds of the way
 * down stays two-thirds of the way down on a laptop screen and on an external monitor.
 *
 * Pure geometry on purpose: components/ChatLauncherDock.tsx owns the pointer events and the
 * DOM, this owns the arithmetic, and chatLauncherPosition.test.ts covers the edges.
 */

export type LauncherSide = "left" | "right";

export interface LauncherPosition {
  side: LauncherSide;
  /** 0 = pinned to the top margin, 1 = pinned to the bottom margin. */
  top: number;
}

export interface LauncherViewport {
  width: number;
  height: number;
}

export interface LauncherBox {
  width: number;
  height: number;
}

/** Matches the resting inset the CSS uses for the un-dragged bubble. */
export const LAUNCHER_MARGIN = 16;

export const LAUNCHER_POSITION_STORAGE_KEY = "mi.chat-launcher.position.v1";

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isLauncherSide(value: unknown): value is LauncherSide {
  return value === "left" || value === "right";
}

/**
 * The vertical travel available to the bubble. Goes to 0 rather than negative on a viewport
 * shorter than the bubble itself, which keeps every caller's arithmetic in range.
 */
export function launcherTravel(viewport: LauncherViewport, box: LauncherBox): number {
  return Math.max(0, viewport.height - box.height - LAUNCHER_MARGIN * 2);
}

/**
 * Resolves a stored position into concrete pixels for `style`. Always inside the margins,
 * whatever the stored fraction was.
 */
export function launcherOffset(
  position: LauncherPosition,
  viewport: LauncherViewport,
  box: LauncherBox,
): { left: number; top: number } {
  const left = position.side === "left"
    ? LAUNCHER_MARGIN
    : Math.max(LAUNCHER_MARGIN, viewport.width - box.width - LAUNCHER_MARGIN);
  return {
    left,
    top: LAUNCHER_MARGIN + clamp(position.top, 0, 1) * launcherTravel(viewport, box),
  };
}

/**
 * Turns the pixel spot a drag ended at into a stored position: nearest vertical edge by the
 * bubble's own center, and the vertical fraction it was released at.
 */
export function snapLauncherPosition(
  point: { left: number; top: number },
  viewport: LauncherViewport,
  box: LauncherBox,
): LauncherPosition {
  const centerX = point.left + box.width / 2;
  const travel = launcherTravel(viewport, box);
  return {
    side: centerX < viewport.width / 2 ? "left" : "right",
    top: travel === 0 ? 0 : clamp((point.top - LAUNCHER_MARGIN) / travel, 0, 1),
  };
}

/** Keeps a bubble fully on screen while it is being dragged. */
export function clampLauncherPoint(
  point: { left: number; top: number },
  viewport: LauncherViewport,
  box: LauncherBox,
): { left: number; top: number } {
  return {
    left: clamp(point.left, LAUNCHER_MARGIN, Math.max(LAUNCHER_MARGIN, viewport.width - box.width - LAUNCHER_MARGIN)),
    top: clamp(point.top, LAUNCHER_MARGIN, Math.max(LAUNCHER_MARGIN, viewport.height - box.height - LAUNCHER_MARGIN)),
  };
}

/** null means "never dragged" -- the caller then leaves the default CSS corner alone. */
export function readStoredLauncherPosition(
  storage: Pick<Storage, "getItem"> | null | undefined,
): LauncherPosition | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAUNCHER_POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { side, top } = parsed as { side?: unknown; top?: unknown };
    if (!isLauncherSide(side) || typeof top !== "number" || !Number.isFinite(top)) return null;
    return { side, top: clamp(top, 0, 1) };
  } catch {
    // Corrupt or unreadable storage just means the bubble goes back to its default corner.
    return null;
  }
}

export function writeStoredLauncherPosition(
  storage: Pick<Storage, "setItem"> | null | undefined,
  position: LauncherPosition,
): void {
  if (!storage) return;
  try {
    storage.setItem(LAUNCHER_POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Where the bubble sits is a convenience, never worth throwing over.
  }
}

export function clearStoredLauncherPosition(
  storage: Pick<Storage, "removeItem"> | null | undefined,
): void {
  if (!storage) return;
  try {
    storage.removeItem(LAUNCHER_POSITION_STORAGE_KEY);
  } catch {
    // Same rationale as writeStoredLauncherPosition.
  }
}

/**
 * How far a pointer has to travel before the gesture counts as a drag rather than a click.
 * Below this the bubble opens chat, which is what a shaky click on a small target does.
 */
export const LAUNCHER_DRAG_THRESHOLD = 4;

export function exceedsDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= LAUNCHER_DRAG_THRESHOLD;
}
