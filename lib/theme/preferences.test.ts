import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_MODE_STORAGE_KEY,
  THEME_PRESET_STORAGE_KEY,
  THEME_GRAPHICS_STORAGE_KEY,
  THEME_MOTION_STORAGE_KEY,
  THEME_TYPOGRAPHY_STORAGE_KEY,
  THEME_CODE_FONT_STORAGE_KEY,
  THEME_MODE_ATTRIBUTE,
  THEME_DISPLAY_ATTRIBUTE,
  THEME_PRESET_ATTRIBUTE,
  THEME_GRAPHICS_ATTRIBUTE,
  THEME_MOTION_ATTRIBUTE,
  THEME_TYPOGRAPHY_ATTRIBUTE,
  THEME_CODE_FONT_ATTRIBUTE,
  applyThemeToDocument,
  buildThemeBootstrapScript,
  clearStoredThemePreference,
  isThemeMode,
  isThemePreset,
  isThemeGraphics,
  isThemeMotion,
  isThemeTypography,
  isThemeCodeFont,
  readStoredThemePreference,
  resolveThemeMode,
  writeStoredThemePreference,
} from "./preferences";

/** Minimal in-memory Storage stand-in, with an option to make getItem/setItem throw. */
function makeStorage(
  values: Record<string, string> = {},
  opts: { throwOnGet?: boolean; throwOnSet?: boolean; throwOnRemove?: boolean } = {},
): Storage {
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
      if (opts.throwOnRemove) throw new Error("blocked");
      delete store[key];
    },
    clear() {
      for (const key of Object.keys(store)) delete store[key];
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
    get length() {
      return Object.keys(store).length;
    },
  } as Storage;
}

describe("isThemeMode / isThemePreset", () => {
  it("restores drafting fonts before hydration and migrates the redundant Cascadia choice", () => {
    const storage = makeStorage({ [THEME_TYPOGRAPHY_STORAGE_KEY]: "drafting", [THEME_CODE_FONT_STORAGE_KEY]: "drafting" });
    expect(readStoredThemePreference(storage)).toMatchObject({ typography: "drafting", codeFont: "drafting" });
    expect(runBootstrapScript({ localStorage: storage })).toMatchObject({ [THEME_TYPOGRAPHY_ATTRIBUTE]: "drafting", [THEME_CODE_FONT_ATTRIBUTE]: "drafting" });
    const legacy = makeStorage({ [THEME_CODE_FONT_STORAGE_KEY]: "cascadia-mono" });
    expect(readStoredThemePreference(legacy).codeFont).toBe("cascadia");
    expect(runBootstrapScript({ localStorage: legacy })[THEME_CODE_FONT_ATTRIBUTE]).toBe("cascadia");
  });
  it.each(["pencil", "tracing"] as const)("restores %s graphics independently of the color mode", (graphics) => {
    const storage = makeStorage({ [THEME_GRAPHICS_STORAGE_KEY]: graphics, [THEME_MODE_STORAGE_KEY]: "dim" });
    expect(readStoredThemePreference(storage)).toMatchObject({ graphics: graphics === "tracing" ? "blueprint" : graphics, mode: "dim" });
    expect(isThemeGraphics(graphics)).toBe(true);
  });
  it("accepts only the documented values", () => {
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("Dark")).toBe(false);
    expect(isThemeMode("auto")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
    expect(isThemeMode(42)).toBe(false);
  });

  it("accepts only the documented presets", () => {
    expect(isThemePreset("blueprint")).toBe(true);
    expect(isThemePreset("cobalt")).toBe(true);
    expect(isThemePreset("slate")).toBe(true);
    expect(isThemePreset("contrast")).toBe(true);
    expect(isThemePreset("terminal")).toBe(true);
    expect(isThemePreset("amber")).toBe(false);
    expect(isThemePreset("")).toBe(false);
  });

  it("validates typography, graphics, and motion independently", () => {
    expect(isThemeTypography("code")).toBe(true);
    expect(isThemeTypography("comic")).toBe(false);
    expect(isThemeCodeFont("plex")).toBe(true);
    expect(isThemeCodeFont("cascadia-mono")).toBe(true);
    expect(isThemeCodeFont("comic-mono")).toBe(false);
    expect(isThemeCodeFont(null)).toBe(false);
    expect(isThemeGraphics("terminal")).toBe(true);
    expect(isThemeGraphics("noise")).toBe(false);
    expect(isThemeMotion("expressive")).toBe(true);
    expect(isThemeMotion("dizzy")).toBe(false);
  });
});

describe("resolveThemeMode", () => {
  it("resolves explicit light/dark regardless of the OS signal", () => {
    expect(resolveThemeMode("light", true)).toBe("light");
    expect(resolveThemeMode("dark", false)).toBe("dark");
    expect(resolveThemeMode("dim", false)).toBe("dark");
    expect(resolveThemeMode("dim", true)).toBe("dark");
  });

  it("resolves system from the OS signal", () => {
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
  });
});

describe("readStoredThemePreference", () => {
  it("falls back to Blueprint + System when storage is absent", () => {
    expect(readStoredThemePreference(null)).toEqual(DEFAULT_THEME_PREFERENCE);
    expect(readStoredThemePreference(undefined)).toEqual(DEFAULT_THEME_PREFERENCE);
  });

  it("falls back to Blueprint + System when keys are missing", () => {
    expect(readStoredThemePreference(makeStorage())).toEqual(DEFAULT_THEME_PREFERENCE);
  });

  it("reads a valid stored preference", () => {
    const storage = makeStorage({
      [THEME_MODE_STORAGE_KEY]: "dark",
      [THEME_PRESET_STORAGE_KEY]: "cobalt",
      [THEME_TYPOGRAPHY_STORAGE_KEY]: "code",
      [THEME_CODE_FONT_STORAGE_KEY]: "plex",
      [THEME_GRAPHICS_STORAGE_KEY]: "terminal",
      [THEME_MOTION_STORAGE_KEY]: "expressive",
    });
    expect(readStoredThemePreference(storage)).toEqual({
      mode: "dark",
      preset: "blueprint",
      typography: "code",
      codeFont: "plex",
      graphics: "clean",
      motion: "expressive",
    });
  });

  it("falls back per-field on an unknown/stale/corrupt value", () => {
    const storage = makeStorage({
      [THEME_MODE_STORAGE_KEY]: "purple-haze",
      [THEME_PRESET_STORAGE_KEY]: "wood",
    });
    expect(readStoredThemePreference(storage)).toEqual(DEFAULT_THEME_PREFERENCE);
  });

  it("keeps a valid preset even if mode is corrupt (fields fall back independently)", () => {
    const storage = makeStorage({
      [THEME_MODE_STORAGE_KEY]: "not-a-mode",
      [THEME_PRESET_STORAGE_KEY]: "slate",
    });
    expect(readStoredThemePreference(storage)).toEqual({
      ...DEFAULT_THEME_PREFERENCE,
      preset: "graphite",
    });
  });

  it("never throws when storage access throws", () => {
    const storage = makeStorage({}, { throwOnGet: true });
    expect(() => readStoredThemePreference(storage)).not.toThrow();
    expect(readStoredThemePreference(storage)).toEqual(DEFAULT_THEME_PREFERENCE);
  });
});

describe("writeStoredThemePreference / clearStoredThemePreference", () => {
  it("writes both fields", () => {
    const storage = makeStorage();
    writeStoredThemePreference(storage, {
      mode: "dark",
      preset: "slate",
      typography: "technical",
      codeFont: "ubuntu",
      graphics: "blueprint",
      motion: "minimal",
    });
    expect(storage.getItem(THEME_MODE_STORAGE_KEY)).toBe("dark");
    expect(storage.getItem(THEME_PRESET_STORAGE_KEY)).toBe("graphite");
    expect(storage.getItem(THEME_TYPOGRAPHY_STORAGE_KEY)).toBe("technical");
    expect(storage.getItem(THEME_CODE_FONT_STORAGE_KEY)).toBe("ubuntu");
    expect(storage.getItem(THEME_GRAPHICS_STORAGE_KEY)).toBe("blueprint");
    expect(storage.getItem(THEME_MOTION_STORAGE_KEY)).toBe("minimal");
  });

  it("never throws when storage is absent or blocked", () => {
    expect(() => writeStoredThemePreference(null, DEFAULT_THEME_PREFERENCE)).not.toThrow();
    const blocked = makeStorage({}, { throwOnSet: true });
    expect(() => writeStoredThemePreference(blocked, DEFAULT_THEME_PREFERENCE)).not.toThrow();
  });

  it("clears both keys", () => {
    const storage = makeStorage({
      [THEME_MODE_STORAGE_KEY]: "dark",
      [THEME_PRESET_STORAGE_KEY]: "cobalt",
    });
    clearStoredThemePreference(storage);
    expect(readStoredThemePreference(storage)).toEqual(DEFAULT_THEME_PREFERENCE);
  });

  it("never throws when clearing is blocked", () => {
    const blocked = makeStorage({}, { throwOnRemove: true });
    expect(() => clearStoredThemePreference(blocked)).not.toThrow();
  });
});

describe("applyThemeToDocument", () => {
  it("no-ops outside a DOM environment instead of throwing", () => {
    expect(typeof document).toBe("undefined");
    expect(() => applyThemeToDocument(DEFAULT_THEME_PREFERENCE, false)).not.toThrow();
  });
});

/**
 * Executes the actual generated bootstrap-script text (not just a
 * hand-written re-implementation of its logic) inside a sandboxed fake DOM,
 * so this test fails if the real script's behavior ever drifts from the
 * pure resolveThemeMode/readStoredThemePreference helpers above.
 */
function runBootstrapScript(options: {
  localStorage?: { getItem(key: string): string | null } | "throw";
  matchMedia?: { matches: boolean } | "throw" | "missing";
} = {}): Record<string, string | undefined> {
  const attributes: Record<string, string> = {};
  const documentElement = {
    setAttribute(name: string, value: string) {
      attributes[name] = value;
    },
  };

  let localStorage: unknown;
  if (options.localStorage === "throw") {
    localStorage = {
      getItem() {
        throw new Error("storage blocked");
      },
    };
  } else if (options.localStorage) {
    localStorage = options.localStorage;
  } else {
    localStorage = { getItem: () => null };
  }

  let matchMedia: unknown;
  if (options.matchMedia === "throw") {
    matchMedia = () => {
      throw new Error("matchMedia blocked");
    };
  } else if (options.matchMedia === "missing") {
    matchMedia = undefined;
  } else {
    const matches = options.matchMedia?.matches ?? false;
    matchMedia = () => ({ matches });
  }

  const sandbox: { window: Record<string, unknown>; document: unknown } = {
    window: { localStorage, matchMedia },
    document: { documentElement },
  };
  vm.createContext(sandbox);
  vm.runInContext(buildThemeBootstrapScript(), sandbox);
  return attributes;
}

describe("buildThemeBootstrapScript (executed in a sandboxed fake DOM)", () => {
  it.each([
    ["cobalt", "blueprint"], ["slate", "graphite"], ["midnight", "blueprint"],
    ["terminal", "ocean"], ["ice", "ocean"], ["ultraviolet", "lavender"],
  ])("migrates %s to %s consistently before and after hydration", (oldPreset, currentPreset) => {
    const storage = makeStorage({ [THEME_PRESET_STORAGE_KEY]: oldPreset, [THEME_MODE_STORAGE_KEY]: "dim", [THEME_GRAPHICS_STORAGE_KEY]: "tracing" });
    const preference = readStoredThemePreference(storage);
    const attributes = runBootstrapScript({ localStorage: storage });
    expect(preference.preset).toBe(currentPreset);
    expect(attributes[THEME_PRESET_ATTRIBUTE]).toBe(currentPreset);
    expect(preference.graphics).toBe("blueprint");
    expect(attributes[THEME_GRAPHICS_ATTRIBUTE]).toBe("blueprint");
    expect(attributes[THEME_DISPLAY_ATTRIBUTE]).toBe(preference.mode);
    writeStoredThemePreference(storage, preference);
    expect(readStoredThemePreference(storage)).toEqual(preference);
  });
  it.each([["neon", "clean"], ["terminal", "clean"], ["tracing", "blueprint"]])("migrates %s graphics without changing motion", (oldGraphics, currentGraphics) => {
    const storage = makeStorage({ [THEME_GRAPHICS_STORAGE_KEY]: oldGraphics, [THEME_MOTION_STORAGE_KEY]: "minimal" });
    expect(readStoredThemePreference(storage)).toMatchObject({ graphics: currentGraphics, motion: "minimal" });
    expect(runBootstrapScript({ localStorage: storage })[THEME_GRAPHICS_ATTRIBUTE]).toBe(currentGraphics);
  });
  it("restores Dim and new palettes before hydration without depending on the OS", () => {
    for (const preset of ["graphite", "ocean", "lavender", "midnight"]) {
      const attrs = runBootstrapScript({ localStorage: makeStorage({ [THEME_MODE_STORAGE_KEY]: "dim", [THEME_PRESET_STORAGE_KEY]: preset }), matchMedia: { matches: false } });
      expect(attrs[THEME_MODE_ATTRIBUTE]).toBe("dark");
      expect(attrs[THEME_DISPLAY_ATTRIBUTE]).toBe("dim");
      expect(attrs[THEME_PRESET_ATTRIBUTE]).toBe(preset === "midnight" ? "blueprint" : preset);
    }
  });
  it("defaults to Blueprint + resolved System (light) with no storage/matchMedia support", () => {
    const attrs = runBootstrapScript({ matchMedia: "missing" });
    expect(attrs[THEME_MODE_ATTRIBUTE]).toBe("light");
    expect(attrs[THEME_PRESET_ATTRIBUTE]).toBe("blueprint");
    expect(attrs[THEME_TYPOGRAPHY_ATTRIBUTE]).toBe("studio");
    expect(attrs[THEME_CODE_FONT_ATTRIBUTE]).toBe("cascadia");
    expect(attrs[THEME_GRAPHICS_ATTRIBUTE]).toBe("clean");
    expect(attrs[THEME_MOTION_ATTRIBUTE]).toBe("subtle");
  });

  it("resolves System against a dark OS preference", () => {
    const attrs = runBootstrapScript({ matchMedia: { matches: true } });
    expect(attrs[THEME_MODE_ATTRIBUTE]).toBe("dark");
    expect(attrs[THEME_PRESET_ATTRIBUTE]).toBe("blueprint");
  });

  it("honors an explicit stored mode/preset regardless of the OS preference", () => {
    const attrs = runBootstrapScript({
      localStorage: {
        getItem: (key) =>
          key === THEME_MODE_STORAGE_KEY
            ? "dark"
            : key === THEME_PRESET_STORAGE_KEY
              ? "terminal"
              : key === THEME_TYPOGRAPHY_STORAGE_KEY
                ? "code"
                : key === THEME_CODE_FONT_STORAGE_KEY
                  ? "plex"
                  : key === THEME_GRAPHICS_STORAGE_KEY
                    ? "terminal"
                    : key === THEME_MOTION_STORAGE_KEY
                      ? "expressive"
                      : null,
      },
      matchMedia: { matches: false },
    });
    expect(attrs[THEME_MODE_ATTRIBUTE]).toBe("dark");
    expect(attrs[THEME_PRESET_ATTRIBUTE]).toBe("ocean");
    expect(attrs[THEME_TYPOGRAPHY_ATTRIBUTE]).toBe("code");
    expect(attrs[THEME_CODE_FONT_ATTRIBUTE]).toBe("plex");
    expect(attrs[THEME_GRAPHICS_ATTRIBUTE]).toBe("clean");
    expect(attrs[THEME_MOTION_ATTRIBUTE]).toBe("expressive");
  });

  it("falls back safely to Blueprint + System when the stored value is unknown/corrupt", () => {
    const attrs = runBootstrapScript({
      localStorage: {
        getItem: (key) =>
          key === THEME_MODE_STORAGE_KEY ? "purple-haze" : key === THEME_PRESET_STORAGE_KEY ? "wood" : null,
      },
      matchMedia: { matches: false },
    });
    expect(attrs[THEME_MODE_ATTRIBUTE]).toBe("light");
    expect(attrs[THEME_PRESET_ATTRIBUTE]).toBe("blueprint");
  });

  it("falls back safely to Blueprint + System when localStorage access throws", () => {
    const attrs = runBootstrapScript({ localStorage: "throw", matchMedia: { matches: true } });
    // mode falls back to "system", which then resolves against the (still
    // functioning) matchMedia signal.
    expect(attrs[THEME_MODE_ATTRIBUTE]).toBe("dark");
    expect(attrs[THEME_PRESET_ATTRIBUTE]).toBe("blueprint");
  });

  it("falls back safely to light when matchMedia itself throws", () => {
    const attrs = runBootstrapScript({ matchMedia: "throw" });
    expect(attrs[THEME_MODE_ATTRIBUTE]).toBe("light");
    expect(attrs[THEME_PRESET_ATTRIBUTE]).toBe("blueprint");
  });

  it("never throws even if document.documentElement is missing entirely", () => {
    const sandbox = { window: { localStorage: { getItem: () => null } }, document: {} };
    vm.createContext(sandbox);
    expect(() => vm.runInContext(buildThemeBootstrapScript(), sandbox)).not.toThrow();
  });

  it("contains no amber/orange or non-cool hex values", () => {
    const script = buildThemeBootstrapScript();
    expect(script).not.toMatch(/amber|orange/i);
  });
});
