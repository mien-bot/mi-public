import { describe, expect, it } from "vitest";
import { wheelZoomAction } from "./zoomGesture";

describe("ctrl + wheel text zoom", () => {
  it("zooms in on scroll up and out on scroll down", () => {
    // DOM deltaY is negative scrolling up -- the opposite of Electron's native wheelTicksY,
    // which is exactly the mix-up that would invert the gesture.
    expect(wheelZoomAction({ ctrlKey: true, deltaY: -120 })).toBe("in");
    expect(wheelZoomAction({ ctrlKey: true, deltaY: 120 })).toBe("out");
  });

  it("accepts Cmd on macOS as well as Ctrl", () => {
    expect(wheelZoomAction({ metaKey: true, deltaY: -3 })).toBe("in");
  });

  it("ignores ordinary scrolling so the page still scrolls", () => {
    expect(wheelZoomAction({ deltaY: -120 })).toBeNull();
    expect(wheelZoomAction({ ctrlKey: false, deltaY: 120 })).toBeNull();
  });

  it("ignores a gesture that carries no movement", () => {
    expect(wheelZoomAction({ ctrlKey: true, deltaY: 0 })).toBeNull();
    expect(wheelZoomAction({ ctrlKey: true })).toBeNull();
    expect(wheelZoomAction({ ctrlKey: true, deltaY: Number.NaN })).toBeNull();
  });
});
