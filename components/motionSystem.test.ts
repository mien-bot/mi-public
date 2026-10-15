import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_MOTIONS, THEME_GRAPHICS, isThemeGraphics } from "@/lib/theme/preferences";

/**
 * Guards the ambient-motion contract in app/globals.css.
 *
 * The whole Cinematic system rests on one property: every *continuous* animation is
 * declared unconditionally and binds `animation-play-state: var(--mi-ambient-play)`, which
 * resolves to `running` only under `[data-mi-motion="cinematic"]`. That is what keeps
 * Minimal/Subtle/Expressive burning exactly zero extra frames while the rules stay written
 * once. A looping animation that forgets to bind it would silently leak motion into every
 * quiet level, which is precisely the regression these tests exist to catch.
 *
 * See docs/design/appearance-themes.md for the narrative version.
 */

const ROOT = path.resolve(__dirname, "..");
const CSS_PATH = path.join(ROOT, "app/globals.css");
const css = readFileSync(CSS_PATH, "utf8");

/** Splits the stylesheet into `selector { body }` pairs, ignoring nesting depth. */
function declarationBlocks(source: string): { selector: string; body: string }[] {
  const blocks: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    blocks.push({ selector: match[1].trim(), body: match[2] });
  }
  return blocks;
}

describe("ambient motion switch", () => {
  it("keeps cinematic motion and recognizes legacy neon without offering another graphics style", () => {
    expect(THEME_MOTIONS).toContain("cinematic");
    expect(isThemeGraphics("neon")).toBe(true);
    expect(THEME_GRAPHICS).not.toContain("neon");
  });

  it("defaults --mi-ambient-play to paused on bare :root", () => {
    expect(css).toMatch(/:root\s*\{\s*--mi-ambient-play:\s*paused;\s*\}/);
  });

  it("resolves --mi-ambient-play to running only under the cinematic motion level", () => {
    const running = declarationBlocks(css).filter((block) =>
      /--mi-ambient-play:\s*running/.test(block.body),
    );
    expect(running).toHaveLength(1);
    expect(running[0].selector).toBe(':root[data-mi-motion="cinematic"]');
  });

  it("forces it back to paused for reduced motion and for a hidden window", () => {
    // Both overrides must restate [data-mi-motion="cinematic"] to outrank the rule that
    // sets `running`. A bare `:root` inside a media query loses on specificity — media
    // context is not specificity — and the switch then reports `running` while the
    // stylesheet claims otherwise.
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root,\s*:root\[data-mi-motion="cinematic"\]\s*\{\s*--mi-ambient-play:\s*paused;/,
    );
    expect(css).toMatch(
      /:root\.mi-window-hidden,\s*:root\.mi-window-hidden\[data-mi-motion="cinematic"\]\s*\{\s*--mi-ambient-play:\s*paused;/,
    );
  });

  it("parks the pre-existing infinite animations while the window is hidden", () => {
    // These predate the switch and keep running at Subtle by design, so they need the
    // hidden-window rule explicitly rather than inheriting it from --mi-ambient-play.
    const block = declarationBlocks(css).find(
      (candidate) =>
        candidate.selector.includes(".mi-window-hidden") &&
        /animation-play-state:\s*paused/.test(candidate.body),
    );
    expect(block, "expected a .mi-window-hidden rule pausing the older loops").toBeDefined();
    for (const selector of [".typing-dot", ".data-flow-edge", ".activity-spinner", ".loading-scan::after"]) {
      expect(block?.selector).toContain(selector);
    }
  });

  it("binds every infinite animation to the switch, or documents why not", () => {
    // The four exemptions are the loops that existed before Cinematic and must keep
    // running at Subtle: they report live state (a spinner, typing, a scan, the loading
    // mark) rather than decorating a resting surface.
    const PRE_EXISTING_LOOPS = [
      ".typing-dot",
      ".animate-mark-loading",
      ".data-flow-edge",
      ".activity-spinner",
      ".loading-scan::after",
    ];

    const offenders = declarationBlocks(css)
      .filter((block) => /animation:[^;]*\binfinite\b/.test(block.body))
      .filter((block) => !/animation-play-state:/.test(block.body))
      .filter((block) => !PRE_EXISTING_LOOPS.some((known) => block.selector.includes(known)))
      .map((block) => block.selector);

    expect(offenders, `infinite animation(s) not bound to --mi-ambient-play: ${offenders.join(", ")}`).toEqual([]);
  });

  it("lets Minimal disable each ambient class outright, not merely pause it", () => {
    const minimalOff = declarationBlocks(css).filter(
      (block) =>
        block.selector.includes('[data-mi-motion="minimal"]') && /animation:\s*none/.test(block.body),
    );
    const covered = minimalOff.map((block) => block.selector).join(" ");
    for (const cls of [
      ".ambient-drift",
      ".health-ring-sweep",
      ".holo-sheen::before",
      ".meter-sheen::after",
      ".neon-breathe",
      ".status-alert",
      ".ambient-caret",
      ".edge-charge",
    ]) {
      expect(covered, `${cls} is not disabled at the Minimal motion level`).toContain(cls);
    }
  });
});

describe("8-bit icon motion", () => {
  /** The rules nested under the Cinematic level, flattened by the block splitter. */
  const spriteRules = declarationBlocks(css).filter((block) =>
    /sprite-bob|sprite-poke|pixel-materialize|pixel-wipe/.test(block.body),
  );

  it("defines the sprite keyframes and wires them to icons", () => {
    for (const name of ["sprite-bob", "sprite-poke", "pixel-materialize", "pixel-wipe"]) {
      expect(css, `missing @keyframes ${name}`).toContain(`@keyframes ${name}`);
    }
    expect(spriteRules.length).toBeGreaterThanOrEqual(4);
  });

  it("times every sprite animation with steps(), which is what makes it read as 8-bit", () => {
    // Easing any of these turns them straight back into ordinary modern UI motion: a
    // sprite holds a pose for a whole frame and snaps, it never glides.
    for (const block of spriteRules) {
      const declarations = block.body.match(/animation:[^;]+;/g) ?? [];
      for (const declaration of declarations) {
        expect(
          declaration,
          `${block.selector} must use steps() timing, got: ${declaration.trim()}`,
        ).toMatch(/steps\(/);
      }
    }
  });

  it("never retains a sprite pose, which would trap fixed-position descendants", () => {
    for (const block of spriteRules) {
      expect(block.body, `${block.selector} must not use forwards/both`).not.toMatch(
        /animation:[^;]*(forwards|both)/,
      );
    }
  });

  it("positions the scanline mask in absolute units, never percentages", () => {
    // Percentage mask-position resolves against (element size - mask size), so an
    // oversized stencil walks clean off a 24px icon and blanks the glyph entirely. That
    // is exactly what happened the first time this shipped.
    const start = css.indexOf("@keyframes pixel-wipe");
    expect(start, "expected a pixel-wipe keyframes block").toBeGreaterThan(-1);
    const frames = css.slice(start, css.indexOf("}", css.indexOf("to {", start)) + 200);
    const positions = frames.match(/mask-position:[^;]+;/g) ?? [];
    expect(positions.length).toBeGreaterThan(0);
    for (const position of positions) {
      expect(position, `mask-position must not use %, got: ${position.trim()}`).not.toMatch(/%/);
    }
  });

  it("keeps the scanline stencil dimming rather than punching holes in the glyph", () => {
    // A fully transparent band deletes part of a 24px icon; a dim one still reads.
    const rule = declarationBlocks(css).find((block) => /mask-image:[^;]*repeating-linear-gradient/.test(block.body) && block.selector.includes("pixel-wipe"));
    expect(rule, "expected a .pixel-wipe mask rule").toBeDefined();
    expect(rule?.body).not.toMatch(/mask-image:[^;]*transparent/);
  });

  it("lets Minimal disable the sprite motion outright", () => {
    const minimal = declarationBlocks(css)
      .filter((block) => block.selector.includes('[data-mi-motion="minimal"]') && /animation:\s*none/.test(block.body))
      .map((block) => block.selector)
      .join(" ");
    for (const cls of [".pixel-icon", ".mode-icon", ".pixel-wipe"]) {
      expect(minimal, `${cls} is not disabled at the Minimal motion level`).toContain(cls);
    }
  });
});

describe("Neon deck graphic style", () => {
  /** The `:root[data-mi-graphics="neon"] ...` rules, as one blob. */
  const neonBody = declarationBlocks(css)
    .filter((block) => block.selector.includes('[data-mi-graphics="neon"]'))
    .map((block) => block.body)
    .join("\n");

  it("actually defines rules for the style", () => {
    expect(neonBody.length).toBeGreaterThan(0);
  });

  it("introduces no hex literal, so it recolors with every preset", () => {
    // Everything neon draws is a color-mix() off --accent/--foreground. A raw hex here
    // would both freeze the style to one hue and threaten appearanceThemes.test.ts's
    // "exactly two literal --accent declarations" invariant.
    const hexes = neonBody.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes, `neon block should use color-mix(var(--accent)), found ${hexes.join(", ")}`).toEqual([]);
  });

  it("keeps every literal --accent declaration outside the preset/graphics blocks", () => {
    // Mirrors the invariant appearanceThemes.test.ts relies on: only the plain :root
    // default and the prefers-color-scheme fallback declare --accent as a hex.
    const literals = [...css.matchAll(/--accent:\s*#[0-9a-fA-F]{6};/g)];
    expect(literals).toHaveLength(2);
  });
});

describe("route-enter fill mode", () => {
  it("never retains a transform on a wrapper, which would trap position: fixed children", () => {
    // The documented bug: `forwards`/`both` on .animate-route-enter made the wrapper the
    // containing block for every fixed descendant, collapsing the pop-out terminal and the
    // floating Personal chat into an empty box.
    const wrapperAnimations = declarationBlocks(css).filter((block) =>
      /\.animate-route-enter|\.stat-card|\.animate-fade-in-up/.test(block.selector),
    );
    for (const block of wrapperAnimations) {
      expect(
        block.body,
        `${block.selector} must not retain its final frame`,
      ).not.toMatch(/animation:[^;]*\b(forwards|both)\b/);
      expect(block.body).not.toMatch(/animation-fill-mode:\s*(forwards|both)/);
    }
  });
});
