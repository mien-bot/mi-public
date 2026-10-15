import { describe, expect, it } from "vitest";
import { buildReviewCommentCsv } from "./commentRegister";

describe("review comment register CSV", () => {
  it("exports sheet-specific findings with RFC-compatible quoting", () => {
    const csv = buildReviewCommentCsv([{
      id: "2026-07-28-guard-review",
      frontmatter: {
        date: "2026-07-28",
        type: "review",
        discipline: "architectural",
        status: "open",
        related_markups: ["A-301"],
        related_code_sections: ["chicago-il:14x-3-306.2"],
      },
      contentMarkdown: [
        "# Guard review",
        "",
        "## Finding",
        "",
        'Guard height is not dimensioned, verify existing conditions.',
        "",
        "## Recommendation",
        "",
        "Add a dimension and code note.",
      ].join("\n"),
    }]);

    expect(csv).toContain('"A-301"');
    expect(csv).toContain('"Guard height is not dimensioned, verify existing conditions."');
    expect(csv).toContain('"chicago-il:14x-3-306.2"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("neutralizes spreadsheet formula prefixes in review text", () => {
    const csv = buildReviewCommentCsv([{
      id: "formula-safety",
      frontmatter: {
        date: "2026-07-28",
        type: "review",
        discipline: "architectural",
        status: "open",
        related_markups: [],
        related_code_sections: [],
      },
      contentMarkdown: "## Finding\n=HYPERLINK(\"https://example.invalid\")\n\n## Recommendation\n+Verify",
    }]);

    expect(csv).toContain(`"'=HYPERLINK(""https://example.invalid"")"`);
    expect(csv).toContain(`"'+Verify"`);
  });
});
