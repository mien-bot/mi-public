import { describe, expect, it } from "vitest";
import { reviewExcerpt } from "./reviewPreviewSummary";
import type { ReviewCardContent } from "./reviewInbox";

function content(overrides: Partial<ReviewCardContent>): ReviewCardContent {
  return { title: "T", body: "", why: "", visibility: "internal", meeting: null, targets: [], evidence: [], ...overrides };
}

describe("reviewExcerpt", () => {
  it("prefers the meeting summary, then why, then body", () => {
    expect(reviewExcerpt(content({ why: "Why text.", body: "Body text." }), "Summary text.")).toBe("Summary text.");
    expect(reviewExcerpt(content({ why: "Why text. More.", body: "Body text." }))).toBe("Why text.");
    expect(reviewExcerpt(content({ body: "Body text. More." }))).toBe("Body text.");
  });

  it("removes links, paths and IDs", () => {
    const body = "Latest copy is ../01_Admin/26_1026_Contract_v2.docx from https://www.notion.so/abc123 (aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb) and is current.";
    const excerpt = reviewExcerpt(content({ body }));
    expect(excerpt).toBe("Latest copy is and is current.");
    expect(reviewExcerpt(content({ body: "Row is blank on the set at ../01_Admin/a.pdf and https://www.notion.so/abc. A second sentence." })))
      .toBe("Row is blank on the set.");
  });

  it("caps long sentences", () => {
    const excerpt = reviewExcerpt(content({ body: "word ".repeat(100) }));
    expect(excerpt.length).toBeLessThanOrEqual(160);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});
