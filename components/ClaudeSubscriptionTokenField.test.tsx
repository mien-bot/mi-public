import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ClaudeSubscriptionTokenField } from "./ClaudeSubscriptionTokenField";

describe("ClaudeSubscriptionTokenField", () => {
  it("describes setup-token storage without displaying a stored value", () => {
    const markup = renderToStaticMarkup(
      <ClaudeSubscriptionTokenField
        configured
        onStore={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(markup).toContain("Claude subscription token");
    expect(markup).toContain("claude setup-token");
    expect(markup).toContain("Configured");
    expect(markup).toContain("Replace");
    expect(markup).toContain("Clear");
    expect(markup).toContain('type="password"');
    expect(markup).toContain('value=""');
  });
});
