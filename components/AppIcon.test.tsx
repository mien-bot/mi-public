import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppIcon } from "./AppIcon";

describe("AppIcon", () => {
  it("renders decorative icons without adding duplicate accessible names", () => {
    const markup = renderToStaticMarkup(<AppIcon name="projects" />);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).toContain("<path");
  });
});
