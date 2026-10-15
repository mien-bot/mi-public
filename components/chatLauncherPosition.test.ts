import { describe, expect, it } from "vitest";
import {
  LAUNCHER_MARGIN,
  LAUNCHER_POSITION_STORAGE_KEY,
  clampLauncherPoint,
  exceedsDragThreshold,
  launcherOffset,
  launcherTravel,
  readStoredLauncherPosition,
  snapLauncherPosition,
  writeStoredLauncherPosition,
} from "./chatLauncherPosition";

const VIEWPORT = { width: 1440, height: 900 };
const BOX = { width: 48, height: 48 };

function makeStorage(values: Record<string, string> = {}, opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}) {
  const store = { ...values };
  return {
    getItem(key: string) {
      if (opts.throwOnGet) throw new Error("blocked");
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key: string, value: string) {
      if (opts.throwOnSet) throw new Error("blocked");
      store[key] = value;
    },
    removeItem(key: string) {
      delete store[key];
    },
  };
}

describe("snapLauncherPosition", () => {
  it("picks the edge the bubble's own center is nearest, not the pointer's", () => {
    // Released just left of the midline: the box spans 690..738, center 714 < 720.
    expect(snapLauncherPosition({ left: 690, top: 400 }, VIEWPORT, BOX).side).toBe("left");
    expect(snapLauncherPosition({ left: 700, top: 400 }, VIEWPORT, BOX).side).toBe("right");
    expect(snapLauncherPosition({ left: 0, top: 400 }, VIEWPORT, BOX).side).toBe("left");
    expect(snapLauncherPosition({ left: 1380, top: 400 }, VIEWPORT, BOX).side).toBe("right");
  });

  it("stores the vertical spot as a fraction of the travel, so a resize keeps it", () => {
    const travel = launcherTravel(VIEWPORT, BOX);
    expect(travel).toBe(900 - 48 - 32);
    const middle = snapLauncherPosition({ left: 40, top: LAUNCHER_MARGIN + travel / 2 }, VIEWPORT, BOX);
    expect(middle.top).toBeCloseTo(0.5, 5);

    // The same fraction resolves to a proportional spot on a shorter window.
    const shorter = { width: 1024, height: 600 };
    const offset = launcherOffset(middle, shorter, BOX);
    expect(offset.top).toBeCloseTo(LAUNCHER_MARGIN + launcherTravel(shorter, BOX) / 2, 5);
  });

  it("clamps a release above or below the usable band", () => {
    expect(snapLauncherPosition({ left: 40, top: -500 }, VIEWPORT, BOX).top).toBe(0);
    expect(snapLauncherPosition({ left: 40, top: 99999 }, VIEWPORT, BOX).top).toBe(1);
  });

  it("degrades to the top margin when the window is shorter than the bubble", () => {
    const tiny = { width: 320, height: 40 };
    expect(launcherTravel(tiny, BOX)).toBe(0);
    expect(snapLauncherPosition({ left: 10, top: 10 }, tiny, BOX).top).toBe(0);
    expect(launcherOffset({ side: "left", top: 1 }, tiny, BOX).top).toBe(LAUNCHER_MARGIN);
  });
});

describe("launcherOffset", () => {
  it("rests against the requested edge, inside the margin", () => {
    expect(launcherOffset({ side: "left", top: 0 }, VIEWPORT, BOX)).toEqual({ left: 16, top: 16 });
    expect(launcherOffset({ side: "right", top: 1 }, VIEWPORT, BOX)).toEqual({
      left: 1440 - 48 - 16,
      top: 900 - 48 - 16,
    });
  });

  it("never resolves off-screen on a window narrower than the bubble", () => {
    const narrow = { width: 40, height: 900 };
    expect(launcherOffset({ side: "right", top: 0 }, narrow, BOX).left).toBe(LAUNCHER_MARGIN);
  });
});

describe("clampLauncherPoint", () => {
  it("keeps a dragged bubble fully on screen", () => {
    expect(clampLauncherPoint({ left: -200, top: -200 }, VIEWPORT, BOX)).toEqual({ left: 16, top: 16 });
    expect(clampLauncherPoint({ left: 99999, top: 99999 }, VIEWPORT, BOX)).toEqual({
      left: 1440 - 48 - 16,
      top: 900 - 48 - 16,
    });
    expect(clampLauncherPoint({ left: 500, top: 300 }, VIEWPORT, BOX)).toEqual({ left: 500, top: 300 });
  });
});

describe("exceedsDragThreshold", () => {
  it("treats a shaky click as a click and a real move as a drag", () => {
    expect(exceedsDragThreshold(0, 0)).toBe(false);
    expect(exceedsDragThreshold(2, 2)).toBe(false);
    expect(exceedsDragThreshold(0, 4)).toBe(true);
    expect(exceedsDragThreshold(-30, 12)).toBe(true);
  });
});

describe("stored launcher position", () => {
  it("round-trips a position", () => {
    const storage = makeStorage();
    writeStoredLauncherPosition(storage, { side: "left", top: 0.25 });
    expect(readStoredLauncherPosition(storage)).toEqual({ side: "left", top: 0.25 });
  });

  it("reports null for absent, corrupt, or out-of-shape values so the default corner wins", () => {
    expect(readStoredLauncherPosition(null)).toBeNull();
    expect(readStoredLauncherPosition(makeStorage())).toBeNull();
    expect(readStoredLauncherPosition(makeStorage({ [LAUNCHER_POSITION_STORAGE_KEY]: "{" }))).toBeNull();
    expect(readStoredLauncherPosition(makeStorage({ [LAUNCHER_POSITION_STORAGE_KEY]: "null" }))).toBeNull();
    expect(readStoredLauncherPosition(makeStorage({ [LAUNCHER_POSITION_STORAGE_KEY]: '{"side":"up","top":0.5}' }))).toBeNull();
    expect(readStoredLauncherPosition(makeStorage({ [LAUNCHER_POSITION_STORAGE_KEY]: '{"side":"left"}' }))).toBeNull();
    expect(readStoredLauncherPosition(makeStorage({ [LAUNCHER_POSITION_STORAGE_KEY]: '{"side":"left","top":"x"}' }))).toBeNull();
  });

  it("clamps a stored fraction that drifted out of range", () => {
    const storage = makeStorage({ [LAUNCHER_POSITION_STORAGE_KEY]: '{"side":"right","top":9}' });
    expect(readStoredLauncherPosition(storage)).toEqual({ side: "right", top: 1 });
  });

  it("never throws when storage is blocked", () => {
    expect(readStoredLauncherPosition(makeStorage({}, { throwOnGet: true }))).toBeNull();
    expect(() => writeStoredLauncherPosition(makeStorage({}, { throwOnSet: true }), { side: "left", top: 0 })).not.toThrow();
    expect(() => writeStoredLauncherPosition(null, { side: "left", top: 0 })).not.toThrow();
  });
});
