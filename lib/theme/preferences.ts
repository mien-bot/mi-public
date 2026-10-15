/**
 * Single source of truth for Mi's appearance preference: display mode,
 * cool-tone color preset, typography, graphic style, and motion. Everything
 * that reads or writes the preference —
 * the blocking pre-hydration bootstrap script embedded in app/layout.tsx,
 * components/ThemeProvider.tsx (live updates after hydration), and
 * components/AppearanceSettings.tsx (the Settings UI) — goes through this
 * module so there is exactly one place that defines the valid values, the
 * storage keys, the DOM attribute names, and the safe-fallback behavior.
 *
 * See docs/design/appearance-themes.md for the full token table, measured
 * contrast, and the CSS side of this (app/globals.css's
 * `[data-mi-preset]`/`[data-mi-theme]` attribute rules).
 */

export type ThemeMode = "system" | "light" | "dark" | "dim";
export type ThemePreset =
  | "blueprint"
  | "cobalt"
  | "slate"
  | "contrast"
  | "terminal"
  | "ultraviolet"
  | "jade"
  | "ice"
  | "graphite"
  | "ocean"
  | "lavender"
  | "midnight";
export type ThemeTypography = "studio" | "technical" | "drafting" | "code";
export type ThemeCodeFont = "cascadia" | "cascadia-mono" | "plex" | "consolas" | "ubuntu" | "drafting";
export type ThemeGraphics = "clean" | "blueprint" | "terminal" | "neon" | "pencil" | "tracing";
/**
 * Cinematic is the only level that runs *continuous* motion (drifting diagram bubbles,
 * sweeping ring tracers, counting figures). Every such animation in app/globals.css binds
 * `animation-play-state: var(--mi-ambient-play)`, and that property resolves to `running`
 * only under `[data-mi-motion="cinematic"]` — so Minimal/Subtle/Expressive keep today's
 * enter-once-and-rest behavior with no extra frames burned. See the "Ambient motion" block
 * in app/globals.css and docs/design/appearance-themes.md.
 */
export type ThemeMotion = "minimal" | "subtle" | "expressive" | "cinematic";
export type ResolvedThemeMode = "light" | "dark";

export const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dim", "dark"];
export const THEME_PRESETS: readonly ThemePreset[] = [
  "blueprint",
  "graphite",
  "ocean",
  "lavender",
  "jade",
  "contrast",
];
export const LEGACY_PRESET_MAP: Partial<Record<ThemePreset, ThemePreset>> = {
  cobalt: "blueprint", slate: "graphite", midnight: "blueprint",
  terminal: "ocean", ice: "ocean", ultraviolet: "lavender",
};
export const LEGACY_GRAPHICS_MAP: Partial<Record<ThemeGraphics, ThemeGraphics>> = {
  tracing: "blueprint", terminal: "clean", neon: "clean",
};
export const THEME_TYPOGRAPHIES: readonly ThemeTypography[] = ["studio", "technical", "drafting", "code"];
// Keep the legacy no-ligature Cascadia value valid, but do not offer two visually
// identical terminal faces: xterm deliberately disables ligatures.
export const THEME_CODE_FONTS: readonly ThemeCodeFont[] = ["cascadia", "plex", "consolas", "ubuntu", "drafting"];
export const THEME_GRAPHICS: readonly ThemeGraphics[] = ["clean", "pencil", "blueprint"];
export const THEME_MOTIONS: readonly ThemeMotion[] = ["minimal", "subtle", "expressive", "cinematic"];

export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_THEME_PRESET: ThemePreset = "blueprint";
export const DEFAULT_THEME_TYPOGRAPHY: ThemeTypography = "studio";
export const DEFAULT_THEME_CODE_FONT: ThemeCodeFont = "cascadia";
export const DEFAULT_THEME_GRAPHICS: ThemeGraphics = "clean";
export const DEFAULT_THEME_MOTION: ThemeMotion = "subtle";

export interface ThemePreference {
  mode: ThemeMode;
  preset: ThemePreset;
  typography: ThemeTypography;
  /** Which monospaced family the Code typography, the terminal, and every
   * `font-mono` surface use. Independent of typography so a coding face is
   * still yours in Studio and Technical, where it shows up in code, paths,
   * IDs, and the terminal. */
  codeFont: ThemeCodeFont;
  graphics: ThemeGraphics;
  motion: ThemeMotion;
}

export const DEFAULT_THEME_PREFERENCE: ThemePreference = Object.freeze({
  mode: DEFAULT_THEME_MODE,
  preset: DEFAULT_THEME_PRESET,
  typography: DEFAULT_THEME_TYPOGRAPHY,
  codeFont: DEFAULT_THEME_CODE_FONT,
  graphics: DEFAULT_THEME_GRAPHICS,
  motion: DEFAULT_THEME_MOTION,
});

/** The three intentional starting points; detailed controls remain independent. */
export const THEME_STYLES: readonly { name: string; description: string; preference: ThemePreference }[] = [
  { name: "Studio", description: "Everyday work. Blue accents, clear type, quiet surfaces.", preference: DEFAULT_THEME_PREFERENCE },
  { name: "Sketchbook", description: "Drawing desk. Graphite, paper texture, architectural lettering.", preference: { mode: "light", preset: "graphite", typography: "drafting", codeFont: "drafting", graphics: "pencil", motion: "subtle" } },
  { name: "Terminal", description: "Focused sessions. Dim surfaces, teal accents, a measured grid.", preference: { mode: "dim", preset: "ocean", typography: "code", codeFont: "cascadia", graphics: "blueprint", motion: "minimal" } },
];

export function normalizeThemePreference(preference: ThemePreference): ThemePreference {
  return { ...preference,
    preset: LEGACY_PRESET_MAP[preference.preset] ?? preference.preset,
    graphics: LEGACY_GRAPHICS_MAP[preference.graphics] ?? preference.graphics,
    codeFont: preference.codeFont === "cascadia-mono" ? "cascadia" : preference.codeFont,
  };
}

// localStorage keys. Client-side only — never sent to a server.
export const THEME_MODE_STORAGE_KEY = "mi-theme-mode";
export const THEME_PRESET_STORAGE_KEY = "mi-theme-preset";
export const THEME_TYPOGRAPHY_STORAGE_KEY = "mi-theme-typography";
export const THEME_CODE_FONT_STORAGE_KEY = "mi-theme-code-font";
export const THEME_GRAPHICS_STORAGE_KEY = "mi-theme-graphics";
export const THEME_MOTION_STORAGE_KEY = "mi-theme-motion";

// Attributes set on <html> (document.documentElement). CSS in
// app/globals.css keys off these exact names.
export const THEME_MODE_ATTRIBUTE = "data-mi-theme";
export const THEME_DISPLAY_ATTRIBUTE = "data-mi-display";
export const THEME_PRESET_ATTRIBUTE = "data-mi-preset";
export const THEME_TYPOGRAPHY_ATTRIBUTE = "data-mi-typography";
export const THEME_CODE_FONT_ATTRIBUTE = "data-mi-code-font";
export const THEME_GRAPHICS_ATTRIBUTE = "data-mi-graphics";
export const THEME_MOTION_ATTRIBUTE = "data-mi-motion";

// Fired on `window` whenever the preference changes within the same
// document (a `storage` event only fires in *other* tabs/windows), so
// components/ThemeProvider.tsx can react immediately in this tab too.
export const THEME_PREFERENCE_EVENT = "mi-theme-preference-changed";

// Character preferences are independent of workspace styles and their reset button.
export const MINI_MI_CHARACTERS = ["robot", "paper", "spark", "owl"] as const;
export type MiniMiCharacter = typeof MINI_MI_CHARACTERS[number];
export const MINI_MI_LABELS: Record<MiniMiCharacter, string> = {
  robot: "Drafting buddy", paper: "Paper pal", spark: "Mi spark", owl: "Studio owl",
};
export const MINI_MI_STORAGE_KEY = "mi-helper-preferences";
export const MINI_MI_REACTION_CHOICES = ["dancing", "jumping", "singing", "breakdancing", "spinning", "sleeping", "walking", "happy", "angry", "sad", "waving", "eating", "looking"] as const;
export type MiniMiReaction = typeof MINI_MI_REACTION_CHOICES[number];
export type MiniMiPreference = {
  character: MiniMiCharacter; animations: boolean; behavior: "playful" | "quiet" | "hidden";
  size: "small" | "medium" | "large"; snoozedUntil: number; favorites: readonly MiniMiReaction[];
};
export const DEFAULT_MINI_MI: MiniMiPreference = Object.freeze({ character: "robot", animations: true,
  behavior: "playful", size: "medium", snoozedUntil: 0, favorites: MINI_MI_REACTION_CHOICES });

export function normalizeMiniMiPreference(value: Partial<MiniMiPreference> | null | undefined): MiniMiPreference {
  return {
    character: MINI_MI_CHARACTERS.includes(value?.character as MiniMiCharacter) ? value!.character! : DEFAULT_MINI_MI.character,
    animations: typeof value?.animations === "boolean" ? value.animations : true,
    behavior: value?.behavior === "quiet" || value?.behavior === "hidden" ? value.behavior : "playful",
    size: value?.size === "small" || value?.size === "large" ? value.size : "medium",
    snoozedUntil: typeof value?.snoozedUntil === "number" && Number.isFinite(value.snoozedUntil) && value.snoozedUntil > 0 ? value.snoozedUntil : 0,
    favorites: Array.isArray(value?.favorites) ? MINI_MI_REACTION_CHOICES.filter(item => value.favorites!.includes(item)) : MINI_MI_REACTION_CHOICES,
  };
}

export function readMiniMiPreference(storage?: Pick<Storage, "getItem"> | null): MiniMiPreference {
  try {
    const value = JSON.parse(storage?.getItem(MINI_MI_STORAGE_KEY) ?? "null");
    return normalizeMiniMiPreference(value);
  } catch { return { ...DEFAULT_MINI_MI }; }
}

export function writeMiniMiPreference(storage: Pick<Storage, "setItem"> | null, value: Partial<MiniMiPreference>): boolean {
  try {
    if (!storage) return false;
    storage.setItem(MINI_MI_STORAGE_KEY, JSON.stringify(normalizeMiniMiPreference(value)));
    notifyThemePreferenceChanged();
    return true;
  } catch { return false; }
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

export function isThemePreset(value: unknown): value is ThemePreset {
  return typeof value === "string" && ((THEME_PRESETS as readonly string[]).includes(value) || Object.hasOwn(LEGACY_PRESET_MAP, value));
}

export function isThemeTypography(value: unknown): value is ThemeTypography {
  return typeof value === "string" && (THEME_TYPOGRAPHIES as readonly string[]).includes(value);
}

export function isThemeCodeFont(value: unknown): value is ThemeCodeFont {
  return value === "cascadia-mono" || (typeof value === "string" && (THEME_CODE_FONTS as readonly string[]).includes(value));
}

export function isThemeGraphics(value: unknown): value is ThemeGraphics {
  return typeof value === "string" && ((THEME_GRAPHICS as readonly string[]).includes(value) || Object.hasOwn(LEGACY_GRAPHICS_MAP, value));
}

export function isThemeMotion(value: unknown): value is ThemeMotion {
  return typeof value === "string" && (THEME_MOTIONS as readonly string[]).includes(value);
}

export const THEME_MODE_LABELS: Record<ThemeMode, { label: string; description: string }> = {
  system: { label: "System", description: "Follow this device's current light/dark setting." },
  light: { label: "Light", description: "Always use the light appearance." },
  dark: { label: "Dark", description: "Always use the dark appearance." },
  dim: { label: "Dim", description: "Softer charcoal surfaces with dark-mode colors, without a near-black background." },
};

export const THEME_PRESET_LABELS: Record<ThemePreset, { label: string; description: string }> = {
  blueprint: { label: "Blueprint", description: "The current default — restrained architectural blue." },
  cobalt: { label: "Cobalt", description: "A brighter, clearer blue accent." },
  slate: { label: "Slate", description: "A quiet, cool gray-blue accent." },
  contrast: { label: "High Contrast", description: "Maximum legibility, with a strong blue focus outline." },
  terminal: { label: "Terminal", description: "Cool phosphor-cyan for a focused command-deck feel." },
  ultraviolet: { label: "Ultraviolet", description: "Deep indigo-violet with a neon edge." },
  jade: { label: "Jade", description: "Phosphor green, like a signal readout." },
  ice: { label: "Ice", description: "Bright glacial cyan at maximum clarity." },
  graphite: { label: "Graphite", description: "Neutral ink and cool paper for a quiet workspace." },
  ocean: { label: "Ocean", description: "Deep teal with soft sea-toned surfaces." },
  lavender: { label: "Lavender", description: "Gentle violet with lightly tinted surfaces." },
  midnight: { label: "Midnight", description: "Navy ink and blue-black surfaces for focused work." },
};

export const THEME_TYPOGRAPHY_LABELS: Record<ThemeTypography, { label: string; description: string }> = {
  studio: { label: "Studio", description: "Calm, familiar system typography." },
  technical: { label: "Technical", description: "Condensed drawing-set character for headings and navigation." },
  drafting: { label: "Architectural lettering", description: "Architects Daughter drawing-sheet headings with readable studio body text." },
  code: { label: "Code", description: "Monospaced throughout, inspired by a professional editor." },
};

export const THEME_CODE_FONT_LABELS: Record<ThemeCodeFont, { label: string; description: string }> = {
  cascadia: { label: "Cascadia Code", description: "Bundled editor face. Terminal ligatures stay off for precise columns." },
  "cascadia-mono": { label: "Cascadia Mono", description: "The same shapes, without ligatures." },
  plex: { label: "IBM Plex Mono", description: "Warmer and a touch wider — kind on long sessions." },
  consolas: { label: "Consolas", description: "Classic Windows editor face; uses bundled Plex Mono on other devices." },
  ubuntu: { label: "Ubuntu Mono", description: "Narrow and compact — fits more on every line." },
  drafting: { label: "Drafting Mono", description: "Share Tech Mono: measured technical lettering with aligned terminal columns." },
};

export const THEME_GRAPHICS_LABELS: Record<ThemeGraphics, { label: string; description: string }> = {
  pencil: { label: "Pencil", description: "Graphite hatching, fine double rules, and sketchbook surfaces." },
  tracing: { label: "Tracing paper", description: "A measured dot grid and layered drawing-sheet edges." },
  clean: { label: "Clean", description: "Minimal surfaces with restrained architectural detail." },
  blueprint: { label: "Blueprint grid", description: "A fine drafting grid and measured corner marks." },
  terminal: { label: "Command deck", description: "Subtle scan lines, data glows, and terminal framing." },
  neon: { label: "Neon deck", description: "Lit edges, deep glow, and a fine drifting grid across every surface." },
};

export const THEME_MOTION_LABELS: Record<ThemeMotion, { label: string; description: string }> = {
  minimal: { label: "Minimal", description: "Keep feedback immediate with almost no decorative movement." },
  subtle: { label: "Subtle", description: "Short, polished transitions for everyday use." },
  expressive: { label: "Expressive", description: "More dimensional route, card, and status motion." },
  cinematic: {
    label: "Cinematic",
    description: "Everything in Expressive, plus continuous ambient motion — drifting diagram bubbles, sweeping meters, and counting figures.",
  },
};

type StorageGetter = Pick<Storage, "getItem">;
type StorageSetter = Pick<Storage, "setItem">;
type StorageRemover = Pick<Storage, "removeItem">;

/**
 * Reads a stored preference and validates every field independently. Any
 * missing storage, missing key, unknown value, or thrown error (private
 * browsing, disabled storage, corrupt data) falls back to the documented
 * safe default for that field rather than throwing or leaving it undefined.
 */
export function readStoredThemePreference(
  storage: StorageGetter | null | undefined,
): ThemePreference {
  if (!storage) {
    return { ...DEFAULT_THEME_PREFERENCE };
  }

  const get = (key: string): string | null => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  const rawMode = get(THEME_MODE_STORAGE_KEY);
  const rawPreset = get(THEME_PRESET_STORAGE_KEY);
  const rawTypography = get(THEME_TYPOGRAPHY_STORAGE_KEY);
  const rawCodeFont = get(THEME_CODE_FONT_STORAGE_KEY);
  const rawGraphics = get(THEME_GRAPHICS_STORAGE_KEY);
  const rawMotion = get(THEME_MOTION_STORAGE_KEY);

  return normalizeThemePreference({
    mode: isThemeMode(rawMode) ? rawMode : DEFAULT_THEME_MODE,
    preset: isThemePreset(rawPreset) ? rawPreset : DEFAULT_THEME_PRESET,
    typography: isThemeTypography(rawTypography) ? rawTypography : DEFAULT_THEME_TYPOGRAPHY,
    codeFont: rawCodeFont === "cascadia-mono" ? "cascadia" : isThemeCodeFont(rawCodeFont) ? rawCodeFont : DEFAULT_THEME_CODE_FONT,
    graphics: isThemeGraphics(rawGraphics) ? rawGraphics : DEFAULT_THEME_GRAPHICS,
    motion: isThemeMotion(rawMotion) ? rawMotion : DEFAULT_THEME_MOTION,
  });
}

/** Best-effort write; storage errors (quota, private mode) are swallowed. */
export function writeStoredThemePreference(
  storage: StorageSetter | null | undefined,
  preference: ThemePreference,
): void {
  if (!storage) return;
  preference = normalizeThemePreference(preference);
  try {
    storage.setItem(THEME_MODE_STORAGE_KEY, preference.mode);
    storage.setItem(THEME_PRESET_STORAGE_KEY, preference.preset);
    storage.setItem(THEME_TYPOGRAPHY_STORAGE_KEY, preference.typography);
    storage.setItem(THEME_CODE_FONT_STORAGE_KEY, preference.codeFont);
    storage.setItem(THEME_GRAPHICS_STORAGE_KEY, preference.graphics);
    storage.setItem(THEME_MOTION_STORAGE_KEY, preference.motion);
  } catch {
    // Ignore — appearance preference is a nice-to-have, not a hard
    // requirement, and must never throw or block rendering.
  }
}

/** Removes the stored preference so a future load resolves to the default. */
export function clearStoredThemePreference(storage: StorageRemover | null | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(THEME_MODE_STORAGE_KEY);
    storage.removeItem(THEME_PRESET_STORAGE_KEY);
    storage.removeItem(THEME_TYPOGRAPHY_STORAGE_KEY);
    storage.removeItem(THEME_CODE_FONT_STORAGE_KEY);
    storage.removeItem(THEME_GRAPHICS_STORAGE_KEY);
    storage.removeItem(THEME_MOTION_STORAGE_KEY);
  } catch {
    // Ignore, same rationale as writeStoredThemePreference.
  }
}

/** Resolves a Mode preference plus a live OS signal into a concrete light/dark value. */
export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): ResolvedThemeMode {
  if (mode === "light") return "light";
  if (mode === "dark" || mode === "dim") return "dark";
  return prefersDark ? "dark" : "light";
}

/** Applies a preference to `document.documentElement`. No-ops outside a DOM environment. */
export function applyThemeToDocument(preference: ThemePreference, prefersDark: boolean): void {
  if (typeof document === "undefined") return;
  preference = normalizeThemePreference(preference);
  const resolved = resolveThemeMode(preference.mode, prefersDark);
  document.documentElement.setAttribute(THEME_MODE_ATTRIBUTE, resolved);
  document.documentElement.setAttribute(THEME_DISPLAY_ATTRIBUTE, preference.mode);
  document.documentElement.setAttribute(THEME_PRESET_ATTRIBUTE, preference.preset);
  document.documentElement.setAttribute(THEME_TYPOGRAPHY_ATTRIBUTE, preference.typography);
  document.documentElement.setAttribute(THEME_CODE_FONT_ATTRIBUTE, preference.codeFont);
  document.documentElement.setAttribute(THEME_GRAPHICS_ATTRIBUTE, preference.graphics);
  document.documentElement.setAttribute(THEME_MOTION_ATTRIBUTE, preference.motion);
}

/** Dispatches THEME_PREFERENCE_EVENT so same-tab listeners (ThemeProvider) can resync. */
export function notifyThemePreferenceChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(THEME_PREFERENCE_EVENT));
}

/**
 * Source text for the blocking inline script embedded in the root layout's
 * <head>, applied before React hydration so there is no flash of the wrong
 * theme. It must be plain, standalone JS — no imports/exports/JSX/TS syntax
 * — since it runs as a raw <script> tag, not through the bundler. The
 * storage keys, attribute names, valid-value lists, and defaults are
 * interpolated from this module's own constants (one source of truth for
 * those); only the small read/validate/resolve logic itself is necessarily
 * re-expressed as inline JS. preferences.test.ts runs this exact string
 * through a sandboxed fake DOM (not just string-matched) to verify its
 * actual behavior, including the corrupt/missing/exception fallback paths.
 */
export function buildThemeBootstrapScript(): string {
  const modes = JSON.stringify(THEME_MODES);
  const presets = JSON.stringify(THEME_PRESETS);
  const defaultMode = JSON.stringify(DEFAULT_THEME_MODE);
  const defaultPreset = JSON.stringify(DEFAULT_THEME_PRESET);
  const defaultTypography = JSON.stringify(DEFAULT_THEME_TYPOGRAPHY);
  const defaultCodeFont = JSON.stringify(DEFAULT_THEME_CODE_FONT);
  const defaultGraphics = JSON.stringify(DEFAULT_THEME_GRAPHICS);
  const defaultMotion = JSON.stringify(DEFAULT_THEME_MOTION);
  const modeKey = JSON.stringify(THEME_MODE_STORAGE_KEY);
  const presetKey = JSON.stringify(THEME_PRESET_STORAGE_KEY);
  const typographyKey = JSON.stringify(THEME_TYPOGRAPHY_STORAGE_KEY);
  const codeFontKey = JSON.stringify(THEME_CODE_FONT_STORAGE_KEY);
  const graphicsKey = JSON.stringify(THEME_GRAPHICS_STORAGE_KEY);
  const motionKey = JSON.stringify(THEME_MOTION_STORAGE_KEY);
  const modeAttr = JSON.stringify(THEME_MODE_ATTRIBUTE);
  const presetAttr = JSON.stringify(THEME_PRESET_ATTRIBUTE);
  const typographyAttr = JSON.stringify(THEME_TYPOGRAPHY_ATTRIBUTE);
  const codeFontAttr = JSON.stringify(THEME_CODE_FONT_ATTRIBUTE);
  const graphicsAttr = JSON.stringify(THEME_GRAPHICS_ATTRIBUTE);
  const motionAttr = JSON.stringify(THEME_MOTION_ATTRIBUTE);

  return (
    "(function(){" +
    "try{" +
    `var MODES=${modes};` +
    `var PRESETS=${presets};` +
    `var PRESET_ALIASES=${JSON.stringify(LEGACY_PRESET_MAP)};` +
    `var GRAPHICS_ALIASES=${JSON.stringify(LEGACY_GRAPHICS_MAP)};` +
    `var TYPOGRAPHIES=${JSON.stringify(THEME_TYPOGRAPHIES)};` +
    `var CODEFONTS=${JSON.stringify(THEME_CODE_FONTS)};` +
    `var GRAPHICS=${JSON.stringify(THEME_GRAPHICS)};` +
    `var MOTIONS=${JSON.stringify(THEME_MOTIONS)};` +
    `var mode=${defaultMode};` +
    `var preset=${defaultPreset};` +
    `var typography=${defaultTypography};` +
    `var codeFont=${defaultCodeFont};` +
    `var graphics=${defaultGraphics};` +
    `var motion=${defaultMotion};` +
    "try{" +
    `var rm=window.localStorage.getItem(${modeKey});` +
    "if(rm&&MODES.indexOf(rm)!==-1){mode=rm;}" +
    `var rp=window.localStorage.getItem(${presetKey});` +
    "if(Object.prototype.hasOwnProperty.call(PRESET_ALIASES,rp)){rp=PRESET_ALIASES[rp];}" +
    "if(rp&&PRESETS.indexOf(rp)!==-1){preset=rp;}" +
    `var rt=window.localStorage.getItem(${typographyKey});` +
    "if(rt&&TYPOGRAPHIES.indexOf(rt)!==-1){typography=rt;}" +
    `var rcf=window.localStorage.getItem(${codeFontKey});` +
    "if(rcf&&CODEFONTS.indexOf(rcf)!==-1){codeFont=rcf;}" +
    `var rg=window.localStorage.getItem(${graphicsKey});` +
    "if(Object.prototype.hasOwnProperty.call(GRAPHICS_ALIASES,rg)){rg=GRAPHICS_ALIASES[rg];}" +
    "if(rg&&GRAPHICS.indexOf(rg)!==-1){graphics=rg;}" +
    `var rmo=window.localStorage.getItem(${motionKey});` +
    "if(rmo&&MOTIONS.indexOf(rmo)!==-1){motion=rmo;}" +
    "}catch(e){" +
    `mode=${defaultMode};preset=${defaultPreset};typography=${defaultTypography};codeFont=${defaultCodeFont};graphics=${defaultGraphics};motion=${defaultMotion};` +
    "}" +
    'var resolved=mode==="dim"?"dark":mode;' +
    'if(mode==="system"){' +
    "var prefersDark=false;" +
    "try{" +
    'prefersDark=!!(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);' +
    "}catch(e){prefersDark=false;}" +
    'resolved=prefersDark?"dark":"light";' +
    "}" +
    "var d=document.documentElement;" +
    `d.setAttribute(${modeAttr},resolved);` +
    `d.setAttribute(${JSON.stringify(THEME_DISPLAY_ATTRIBUTE)},mode);` +
    `d.setAttribute(${presetAttr},preset);` +
    `d.setAttribute(${typographyAttr},typography);` +
    `d.setAttribute(${codeFontAttr},codeFont);` +
    `d.setAttribute(${graphicsAttr},graphics);` +
    `d.setAttribute(${motionAttr},motion);` +
    "}catch(e){}" +
    "})();"
  );
}
