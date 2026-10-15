import { describe, expect, it } from "vitest";
import { collectCodeSectionCitations } from "./crossRefs";

describe("collectCodeSectionCitations", () => {
  const projects = [{ slug: "sample", meta: { name: "Sample Project" } }];
  const readers = {
    checklist: () => ({
      checklist_id: "test",
      items: [{
        id: "egress",
        description: "Check occupant load",
        code_refs: ["ibc-2021:1004.5"],
        discipline: "architectural" as const,
        status: "pending" as const,
        checked_by: null,
        checked_date: null,
        evidence: [],
      }],
    }),
    reviews: () => [{
      slug: "review",
      frontmatter: {
        date: "2026-07-25",
        type: "review" as const,
        discipline: "architectural" as const,
        status: "open" as const,
        related_markups: [],
        related_code_sections: ["ibc-2021:1004.5"],
      },
      contentMarkdown: "",
      contentHtml: "",
    }],
    markups: () => [],
  };

  it("finds checklist and review citations", () => {
    const citations = collectCodeSectionCitations("ibc-2021:1004.5", projects, readers);
    expect(citations.checklistItems[0]?.projectSlug).toBe("sample");
    expect(citations.reviews[0]?.projectSlug).toBe("sample");
  });

  it("returns empty arrays for a code id nothing cites", () => {
    expect(collectCodeSectionCitations("missing", projects, readers)).toEqual({
      checklistItems: [],
      reviews: [],
      markups: [],
    });
  });
});
