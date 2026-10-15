import { describe, expect, it, vi } from "vitest";

const {
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  installZoomControls,
  keyboardZoomAction,
  applyZoomAction,
  nextZoomLevel,
} = require("./desktopZoom");

describe("desktop app zoom", () => {
  it("maps standard Ctrl/Cmd keyboard shortcuts", () => {
    expect(keyboardZoomAction({ type: "keyDown", control: true, key: "=" })).toBe("in");
    expect(keyboardZoomAction({ type: "keyDown", meta: true, key: "+" })).toBe("in");
    expect(keyboardZoomAction({ type: "keyDown", control: true, code: "NumpadAdd" })).toBe("in");
    expect(keyboardZoomAction({ type: "keyDown", control: true, key: "-" })).toBe("out");
    expect(keyboardZoomAction({ type: "keyDown", meta: true, key: "0" })).toBe("reset");
  });

  it("ignores unrelated, modified, and key-up input", () => {
    expect(keyboardZoomAction({ type: "keyDown", key: "+" })).toBeNull();
    expect(keyboardZoomAction({ type: "keyUp", control: true, key: "+" })).toBeNull();
    expect(keyboardZoomAction({ type: "keyDown", control: true, alt: true, key: "+" })).toBeNull();
    expect(keyboardZoomAction({ type: "keyDown", control: true, key: "p" })).toBeNull();
  });

  it("applies a zoom action to a web contents", () => {
    let level = 0;
    const webContents = {
      getZoomLevel: () => level,
      setZoomLevel: (next: number) => { level = next; },
    };

    // Ctrl+wheel is interpreted in the renderer (lib/zoomGesture.ts) and arrives here as one
    // of these action strings; anything else must not move the zoom.
    expect(applyZoomAction(webContents, "in")).toBe(1);
    expect(applyZoomAction(webContents, "out")).toBe(0);
    expect(applyZoomAction(webContents, "reset")).toBe(0);
    expect(applyZoomAction(webContents, "sideways")).toBeNull();
    expect(level).toBe(0);
  });

  it("steps, resets, and clamps the zoom level", () => {
    expect(nextZoomLevel(0, "in")).toBe(1);
    expect(nextZoomLevel(0, "out")).toBe(-1);
    expect(nextZoomLevel(3, "reset")).toBe(0);
    expect(nextZoomLevel(MAX_ZOOM_LEVEL, "in")).toBe(MAX_ZOOM_LEVEL);
    expect(nextZoomLevel(MIN_ZOOM_LEVEL, "out")).toBe(MIN_ZOOM_LEVEL);
  });

  it("installs working keyboard and mouse handlers", () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const webContents = {
      getZoomLevel: vi.fn(() => 0),
      setZoomLevel: vi.fn(),
      on: vi.fn((event: string, listener: (...args: any[]) => void) => {
        listeners.set(event, listener);
      }),
      removeListener: vi.fn(),
    };
    const cleanup = installZoomControls(webContents);
    const keyboardEvent = { preventDefault: vi.fn() };

    listeners.get("before-input-event")?.(keyboardEvent, {
      type: "keyDown",
      control: true,
      key: "+",
    });

    expect(keyboardEvent.preventDefault).toHaveBeenCalledOnce();
    expect(webContents.setZoomLevel).toHaveBeenNthCalledWith(1, 1);

    // Wheel zoom deliberately has no listener here: before-mouse-event never delivered one,
    // so the gesture lives in the renderer and comes back through the "zoom:step" IPC.
    expect(listeners.has("before-mouse-event")).toBe(false);

    cleanup();
    expect(webContents.removeListener).toHaveBeenCalledTimes(1);
  });
});
