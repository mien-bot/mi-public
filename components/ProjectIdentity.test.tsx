import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectIdentity } from "./ProjectIdentity";

describe("ProjectIdentity", () => {
  it("builds a stable, decorative project mark from confirmed identity text", () => {
    const first = renderToStaticMarkup(<ProjectIdentity name="South Example" slug="example-project-59" />);
    const second = renderToStaticMarkup(<ProjectIdentity name="South Example" slug="example-project-59" />);
    expect(first).toBe(second);
    expect(first).toContain("SE");
    expect(first).toContain('aria-hidden="true"');
  });
});
