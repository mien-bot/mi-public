import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MiMark } from "./MiMark";

describe("MiMark", () => {
  it("draws the optional chat-surface gradient from the live appearance tokens, not a fixed hue", () => {
    const markup = renderToStaticMarkup(<MiMark gradient className="h-8 w-8" />);
    expect(markup).toContain("linearGradient");
    expect(markup).toContain('fill="url(#mi-mark-accent-gradient)"');
    // The mark used to be a hardcoded blue-to-violet ramp, which left it stubbornly blue
    // under the cyan/violet/jade presets while the rest of the window recolored.
    expect(markup).toContain("var(--accent)");
    expect(markup).toContain("var(--accent-hover)");
  });

  it("has no hardcoded hue left in the gradient", () => {
    const markup = renderToStaticMarkup(<MiMark gradient className="h-8 w-8" />);
    // #ffffff is the light rim that --accent is mixed toward, not a hue of its own.
    const hexes = markup.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    expect(hexes.filter((hex) => hex.toLowerCase() !== "#ffffff")).toEqual([]);
  });

  it("remains currentColor by default for existing monochrome uses", () => {
    expect(renderToStaticMarkup(<MiMark />)).toContain('fill="currentColor"');
  });
});
