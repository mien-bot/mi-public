import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeatureGuide, MI_FEATURE_GROUPS } from "./FeatureGuide";

describe("new-user feature guide", () => {
  it("keeps feature destinations unique and covers the main product areas", () => {
    expect(MI_FEATURE_GROUPS).toHaveLength(6);
    expect(new Set(MI_FEATURE_GROUPS.map((feature) => feature.href)).size).toBe(6);
    expect(MI_FEATURE_GROUPS.flatMap((feature) => feature.capabilities)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/milestones/i),
        expect.stringMatching(/Notion/i),
        expect.stringMatching(/Codes Library/i),
      ]),
    );
  });

  it("can render a compact onboarding-safe version without navigation links", () => {
    const markup = renderToStaticMarkup(<FeatureGuide compact showLinks={false} />);
    expect(markup).toContain("Ask Mi and work with AI");
    expect(markup).toContain("Connect your working environment");
    expect(markup).not.toMatch(/<a(?:\s|>)/);
  });
});
