import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_PRESETS, type ThemePreset } from "@/lib/theme/preferences";

/**
 * Verifies the CSS side of the appearance-theme system in app/globals.css:
 * every documented preset defines a full light/dark accent token set, the
 * Tailwind `dark:` variant is rebound to the theme attribute (so existing
 * `dark:*` utility classes elsewhere in the app follow an explicit
 * Light/Dark choice, not just the OS media query), no preset drifts into
 * amber/orange, and every preset clears WCAG AA contrast — computed here
 * with the standard relative-luminance formula against this file's actual
 * --background values, not assumed.
 *
 * See docs/design/appearance-themes.md for the full narrative token table.
 */

const ROOT = path.resolve(__dirname, "..");
const CSS_PATH = path.join(ROOT, "app/globals.css");

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const AMBER_ORANGE_UTILITY_CLASS =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|accent|decoration|caret|divide|placeholder)-(?:amber|orange)(?:-\d{2,4})?(?:\/\d{1,3})?\b/i;

function readCss(): string {
  return readFileSync(CSS_PATH, "utf8");
}

function extractVarHex(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})\\s*;`));
  if (!match) {
    throw new Error(`expected app/globals.css to define ${name} as a hex color`);
  }
  return `#${match[1]}`;
}

/**
 * Extracts the raw (unparsed) declaration value for `name` from a block of
 * CSS text — used for tokens that aren't a plain hex color (e.g. `--border`
 * is `rgb(245 245 244 / 12%)` in dark mode).
 */
function extractRawValue(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) {
    throw new Error(`expected to find ${name} in block`);
  }
  return match[1].trim();
}

/**
 * Extracts the `{ ... }` body of the first rule whose selector text
 * (exact substring match) is `selector`, via brace counting so nested
 * `@media { :root { ... } }` blocks resolve to the right inner scope
 * when `css` is itself an already-extracted block.
 */
function extractRuleBlock(css: string, selector: string): string {
  const selectorIndex = css.indexOf(selector);
  if (selectorIndex === -1) {
    throw new Error(`expected to find rule "${selector}" in app/globals.css`);
  }
  const openBrace = css.indexOf("{", selectorIndex);
  if (openBrace === -1) {
    throw new Error(`expected an opening brace after "${selector}"`);
  }
  let depth = 0;
  for (let i = openBrace; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        return css.slice(openBrace + 1, i);
      }
    }
  }
  throw new Error(`unterminated rule "${selector}" in app/globals.css`);
}

const LIGHT_BACKGROUND = "#ffffff";
const DARK_BACKGROUND = "#0a0a0a";

describe("appearance presets — app/globals.css", () => {
  const css = readCss();

  it("rebinds Tailwind's dark: variant to the resolved theme attribute", () => {
    expect(css).toMatch(
      /@custom-variant dark \(&:where\(\[data-mi-theme="dark"\], \[data-mi-theme="dark"\] \*\)\);/,
    );
  });

  it("defines exactly the documented presets, each with a full light/dark token set", () => {
    expect(THEME_PRESETS).toEqual([
      "blueprint",
      "graphite",
      "ocean",
      "lavender",
      "jade",
      "contrast",
    ]);
    for (const preset of THEME_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        expect(css).toMatch(new RegExp(`--mi-${preset}-accent-${mode}:\\s*#[0-9a-fA-F]{6};`));
        expect(css).toMatch(new RegExp(`--mi-${preset}-accent-foreground-${mode}:\\s*#[0-9a-fA-F]{6};`));
        expect(css).toMatch(new RegExp(`--mi-${preset}-link-${mode}:\\s*#[0-9a-fA-F]{6};`));
      }
    }
  });

  it("has an attribute-scoped rule resolving --accent/--link for every preset x mode", () => {
    for (const preset of THEME_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        const selector = `:root[data-mi-preset="${preset}"][data-mi-theme="${mode}"]`;
        expect(css).toContain(selector);
      }
    }
  });

  it("has no amber/orange Tailwind utility classes anywhere in the file", () => {
    const match = css.match(AMBER_ORANGE_UTILITY_CLASS);
    expect(match, `found amber/orange utility class "${match?.[0]}"`).toBeNull();
  });

  it("reinforces focus visibility for High Contrast without touching the color rings elsewhere", () => {
    expect(css).toMatch(/\[data-mi-preset="contrast"\]\s*:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--accent\);/);
  });

  describe.each(THEME_PRESETS)("%s preset contrast", (preset: ThemePreset) => {
    it("clears WCAG AA (4.5:1) for accent-as-text and accent-foreground-on-accent, in both modes", () => {
      const lightAccent = extractVarHex(css, `--mi-${preset}-accent-light`);
      const lightAccentFg = extractVarHex(css, `--mi-${preset}-accent-foreground-light`);
      const darkAccent = extractVarHex(css, `--mi-${preset}-accent-dark`);
      const darkAccentFg = extractVarHex(css, `--mi-${preset}-accent-foreground-dark`);

      const lightTextContrast = contrastRatio(lightAccent, LIGHT_BACKGROUND);
      const lightButtonContrast = contrastRatio(lightAccentFg, lightAccent);
      const darkTextContrast = contrastRatio(darkAccent, DARK_BACKGROUND);
      const darkButtonContrast = contrastRatio(darkAccentFg, darkAccent);

      expect(lightTextContrast).toBeGreaterThanOrEqual(4.5);
      expect(lightButtonContrast).toBeGreaterThanOrEqual(4.5);
      expect(darkTextContrast).toBeGreaterThanOrEqual(4.5);
      expect(darkButtonContrast).toBeGreaterThanOrEqual(4.5);
    });

    it("stays cool-toned (blue channel at least as strong as red) in both modes", () => {
      const lightAccent = extractVarHex(css, `--mi-${preset}-accent-light`);
      const darkAccent = extractVarHex(css, `--mi-${preset}-accent-dark`);
      for (const hex of [lightAccent, darkAccent]) {
        const clean = hex.replace("#", "");
        const r = parseInt(clean.slice(0, 2), 16);
        const b = parseInt(clean.slice(4, 6), 16);
        expect(b).toBeGreaterThanOrEqual(r);
      }
    });
  });

  it("High Contrast measurably exceeds the three standard blue presets' contrast", () => {
    const others: ThemePreset[] = ["blueprint", "cobalt", "slate"];
    const contrastLight = contrastRatio(extractVarHex(css, "--mi-contrast-accent-light"), LIGHT_BACKGROUND);
    const contrastDark = contrastRatio(extractVarHex(css, "--mi-contrast-accent-dark"), DARK_BACKGROUND);
    for (const other of others) {
      const otherLight = contrastRatio(extractVarHex(css, `--mi-${other}-accent-light`), LIGHT_BACKGROUND);
      const otherDark = contrastRatio(extractVarHex(css, `--mi-${other}-accent-dark`), DARK_BACKGROUND);
      expect(contrastLight).toBeGreaterThan(otherLight);
      expect(contrastDark).toBeGreaterThan(otherDark);
    }
  });

  it.each(THEME_PRESETS)("%s text remains legible on page, card and muted surfaces in Light, Dark and Dim", (preset) => {
    for (const mode of ["light", "dark", "dim"] as const) {
      const resolved = mode === "dim" ? "dark" : mode;
      const base = extractRuleBlock(css, `:root[data-mi-theme="${resolved}"]`);
      const palette = extractRuleBlock(css, `:root[data-mi-preset="${preset}"][data-mi-theme="${resolved}"]`);
      const dim = mode === "dim" ? extractRuleBlock(css, ':root[data-mi-theme="dark"][data-mi-display="dim"]') : "";
      const value = (name: string) => {
        const block = [dim, palette, base].find(rule => rule.includes(`${name}:`))!;
        const raw = extractRawValue(block, name);
        return raw.startsWith("var(") ? extractVarHex(css, raw.slice(4, -1)) : raw;
      };
      for (const surface of ["--background", "--card", "--muted"]) {
        for (const ink of ["--foreground", "--muted-foreground", "--accent"]) {
          expect(contrastRatio(value(ink), value(surface)), `${preset}/${mode} ${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  describe("base surface tokens follow the explicit data-mi-theme choice, not the OS", () => {
    // The plain :root default and the @media (prefers-color-scheme: dark)
    // block are the OS-driven fallback ONLY. Once data-mi-theme is set,
    // :root[data-mi-theme="light"|"dark"] must fully override every core
    // surface/status token — this is the actual bug fix (previously only
    // --accent/--accent-foreground/--link were attribute-scoped, so picking
    // "Light" on a dark-OS machine left --background/--muted/etc. on their
    // OS-driven dark values).
    const plainRootBlock = extractRuleBlock(css, ":root");
    const darkMediaBlock = extractRuleBlock(css, "@media (prefers-color-scheme: dark)");
    const darkMediaRootBlock = extractRuleBlock(darkMediaBlock, ":root");
    const lightThemeBlock = extractRuleBlock(css, ':root[data-mi-theme="light"]');
    const darkThemeBlock = extractRuleBlock(css, ':root[data-mi-theme="dark"]');

    const BASE_TOKENS = [
      "--background",
      "--foreground",
      "--card",
      "--border",
      "--border-strong",
      "--muted",
      "--muted-foreground",
      "--status-success",
      "--status-success-foreground",
      "--status-warning",
      "--status-warning-foreground",
      "--status-danger",
      "--status-danger-foreground",
    ];

    it("is not nested inside the prefers-color-scheme media query (so it can't be OS-gated)", () => {
      expect(darkMediaBlock).not.toContain('data-mi-theme="light"');
      expect(darkMediaBlock).not.toContain('data-mi-theme="dark"');
    });

    it.each(BASE_TOKENS)("%s in :root[data-mi-theme=\"light\"] matches the plain :root (OS-light) value", (token) => {
      expect(extractRawValue(lightThemeBlock, token)).toBe(extractRawValue(plainRootBlock, token));
    });

    it.each(BASE_TOKENS)("%s in :root[data-mi-theme=\"dark\"] matches the @media dark (OS-dark) value", (token) => {
      expect(extractRawValue(darkThemeBlock, token)).toBe(extractRawValue(darkMediaRootBlock, token));
    });

    it("light and dark resolve to different --background/--foreground/--muted values (a real flip, not a no-op)", () => {
      expect(extractRawValue(lightThemeBlock, "--background")).not.toBe(extractRawValue(darkThemeBlock, "--background"));
      expect(extractRawValue(lightThemeBlock, "--foreground")).not.toBe(extractRawValue(darkThemeBlock, "--foreground"));
      expect(extractRawValue(lightThemeBlock, "--muted")).not.toBe(extractRawValue(darkThemeBlock, "--muted"));
    });
  });

  describe("chat-bubble token pairings clear WCAG AA (4.5:1) in every preset x mode", () => {
    const lightThemeBlock = extractRuleBlock(css, ':root[data-mi-theme="light"]');
    const darkThemeBlock = extractRuleBlock(css, ':root[data-mi-theme="dark"]');

    function resolvedForeground(preset: ThemePreset, mode: "light" | "dark"): string {
      if (preset === "contrast") {
        return extractVarHex(css, `--mi-contrast-foreground-${mode}`);
      }
      return extractVarHex(mode === "light" ? lightThemeBlock : darkThemeBlock, "--foreground");
    }

    function resolvedMuted(mode: "light" | "dark"): string {
      return extractVarHex(mode === "light" ? lightThemeBlock : darkThemeBlock, "--muted");
    }

    function resolvedStatusDanger(mode: "light" | "dark"): { bg: string; fg: string } {
      const block = mode === "light" ? lightThemeBlock : darkThemeBlock;
      return {
        bg: extractVarHex(block, "--status-danger"),
        fg: extractVarHex(block, "--status-danger-foreground"),
      };
    }

    describe.each(THEME_PRESETS)("%s preset", (preset: ThemePreset) => {
      it.each(["light", "dark"] as const)("bg-muted / text-foreground clears 4.5:1 in %s mode", (mode) => {
        const ratio = contrastRatio(resolvedMuted(mode), resolvedForeground(preset, mode));
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });

      it.each(["light", "dark"] as const)("bg-accent / text-accent-foreground clears 4.5:1 in %s mode", (mode) => {
        const accent = extractVarHex(css, `--mi-${preset}-accent-${mode}`);
        const accentForeground = extractVarHex(css, `--mi-${preset}-accent-foreground-${mode}`);
        const ratio = contrastRatio(accent, accentForeground);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });

      it.each(["light", "dark"] as const)("bg-status-danger / text-status-danger-foreground clears 4.5:1 in %s mode", (mode) => {
        const { bg, fg } = resolvedStatusDanger(mode);
        const ratio = contrastRatio(bg, fg);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    });
  });

  describe("--accent-hover / --link-hover: distinct, documented hover step per preset x mode", () => {
    it("@theme inline exposes --color-accent-hover and --color-link-hover as real Tailwind colors", () => {
      expect(css).toMatch(/--color-accent-hover:\s*var\(--accent-hover\);/);
      expect(css).toMatch(/--color-link-hover:\s*var\(--link-hover\);/);
    });

    it("every attribute-scoped preset x mode rule resolves --accent-hover and --link-hover", () => {
      for (const preset of THEME_PRESETS) {
        for (const mode of ["light", "dark"] as const) {
          expect(css).toMatch(new RegExp(`--mi-${preset}-accent-hover-${mode}:\\s*#[0-9a-fA-F]{6};`));
          expect(css).toMatch(new RegExp(`--mi-${preset}-link-hover-${mode}:\\s*#[0-9a-fA-F]{6};`));
        }
      }
    });

    describe.each(THEME_PRESETS)("%s preset", (preset: ThemePreset) => {
      it.each(["light", "dark"] as const)("--accent-hover is distinct from --accent and clears a 3:1 floor against its own background, in %s mode", (mode) => {
        const accent = extractVarHex(css, `--mi-${preset}-accent-${mode}`);
        const accentHover = extractVarHex(css, `--mi-${preset}-accent-hover-${mode}`);
        const accentForeground = extractVarHex(css, `--mi-${preset}-accent-foreground-${mode}`);
        const ownBackground = mode === "light" ? LIGHT_BACKGROUND : DARK_BACKGROUND;

        expect(accentHover.toLowerCase()).not.toBe(accent.toLowerCase());
        expect(contrastRatio(accentHover, ownBackground)).toBeGreaterThanOrEqual(3);
        // The button label (accent-foreground) must stay legible while hovered.
        expect(contrastRatio(accentHover, accentForeground)).toBeGreaterThanOrEqual(4.5);
      });

      it.each(["light", "dark"] as const)("hover step darkens on light backgrounds and lightens on dark backgrounds, like --accent-dark vs --accent-light", (mode) => {
        const accent = extractVarHex(css, `--mi-${preset}-accent-${mode}`);
        const accentHover = extractVarHex(css, `--mi-${preset}-accent-hover-${mode}`);
        const ownBackground = mode === "light" ? LIGHT_BACKGROUND : DARK_BACKGROUND;
        // Hover should sit further from the page background than the resting
        // accent — darker (lower luminance) on light backgrounds, lighter
        // (higher luminance) on dark backgrounds.
        const hoverContrastVsBg = contrastRatio(accentHover, ownBackground);
        const restContrastVsBg = contrastRatio(accent, ownBackground);
        expect(hoverContrastVsBg).toBeGreaterThan(restContrastVsBg);
      });
    });

    it("--link-hover mirrors --accent-hover per preset x mode (links and buttons share one accent hue)", () => {
      for (const preset of THEME_PRESETS) {
        for (const mode of ["light", "dark"] as const) {
          const accentHover = extractVarHex(css, `--mi-${preset}-accent-hover-${mode}`);
          const linkHover = extractVarHex(css, `--mi-${preset}-link-hover-${mode}`);
          expect(linkHover).toBe(accentHover);
        }
      }
    });
  });

  it("scopes the flat bg-accent hover fix to real <button> elements, not decorative bg-accent uses", () => {
    expect(css).toMatch(/button\.bg-accent:not\(:disabled\):hover\s*\{\s*background-color:\s*var\(--accent-hover\);\s*\}/);
  });
});
