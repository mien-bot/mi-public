import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the blue visual system: fails if the retired amber/orange "wood"
 * accent (hardcoded hex values or Tailwind amber/orange utility classes)
 * is reintroduced anywhere in this task's owned scope. See
 * docs/design/blue-palette.md for the current documented palette.
 */

const ROOT = path.resolve(__dirname, "..");

// Every hex value the old amber/orange palette used, across light and dark
// mode, for --accent/--link and the four --status-* pairs.
const RETIRED_HEX_VALUES = [
  "b3793a",
  "9c6a2e",
  "e0b88a",
  "f3e6d1",
  "7a4f18",
  "f3ddd3",
  "8a3a20",
  "3a2a12",
  "3a1f14",
  "e8a988",
];

// Matches Tailwind utility classes like bg-amber-500, text-orange-400/30,
// border-amber-500, ring-orange-600, from-amber-200, etc.
const AMBER_ORANGE_UTILITY_CLASS =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|accent|decoration|caret|divide|placeholder)-(?:amber|orange)(?:-\d{2,4})?(?:\/\d{1,3})?\b/i;

const HEX_PATTERN = new RegExp(`#(?:${RETIRED_HEX_VALUES.join("|")})\\b`, "i");

const SOURCE_FILES = [
  "app/globals.css",
  "app/loading.tsx",
  "components/PortfolioCharts.tsx",
  "components/PortfolioAnalysis.tsx",
  "components/ProjectDetailsEditor.tsx",
  "components/ProjectMilestoneOverview.tsx",
  "components/StatusBadge.tsx",
  "components/TerminalPanel.tsx",
  "components/MiMark.tsx",
  "components/MiWordmark.tsx",
];

// Documentation is checked for the retired hex values only — prose is
// allowed to describe the old palette in words ("amber", "orange") without
// literally restating a removed hex code.
const DOC_FILES = ["docs/design/blue-palette.md"];

describe("blue visual system — no retired amber/orange accent", () => {
  it.each(SOURCE_FILES)("%s has no retired hex values", (relativePath) => {
    const contents = readFileSync(path.join(ROOT, relativePath), "utf8");
    const match = contents.match(HEX_PATTERN);
    expect(match, `found retired hex ${match?.[0]} in ${relativePath}`).toBeNull();
  });

  it.each(SOURCE_FILES)("%s has no amber/orange Tailwind utility classes", (relativePath) => {
    const contents = readFileSync(path.join(ROOT, relativePath), "utf8");
    const match = contents.match(AMBER_ORANGE_UTILITY_CLASS);
    expect(match, `found amber/orange utility class "${match?.[0]}" in ${relativePath}`).toBeNull();
  });

  it.each(DOC_FILES)("%s has no retired hex values", (relativePath) => {
    const contents = readFileSync(path.join(ROOT, relativePath), "utf8");
    const match = contents.match(HEX_PATTERN);
    expect(match, `found retired hex ${match?.[0]} in ${relativePath}`).toBeNull();
  });

  it("app/globals.css defines --accent, --accent-foreground, and --link as blue in both themes", () => {
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const [lightBlock, darkBlock] = css.split("@media (prefers-color-scheme: dark)");
    for (const block of [lightBlock, darkBlock]) {
      expect(block).toMatch(/--accent:\s*#[0-9a-f]{6};/i);
      expect(block).toMatch(/--accent-foreground:\s*#[0-9a-f]{6};/i);
      expect(block).toMatch(/--link:\s*#[0-9a-f]{6};/i);
    }
    // Sanity-check the actual accent hue is blue-family (not warm), i.e. the
    // blue channel is the dominant or a strongly represented channel and red
    // isn't dominant, for both the light and dark accent value.
    const accentHexes = [...css.matchAll(/--accent:\s*#([0-9a-f]{6});/gi)].map((m) => m[1]);
    expect(accentHexes.length).toBe(2);
    for (const hex of accentHexes) {
      const r = parseInt(hex.slice(0, 2), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      expect(b).toBeGreaterThan(r);
    }
  });
});
