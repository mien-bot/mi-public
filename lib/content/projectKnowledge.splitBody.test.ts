import { describe, expect, it } from "vitest";
import { splitKnowledgeBody } from "./projectKnowledge";

describe("splitKnowledgeBody", () => {
  it("keeps the note readable and moves Mi's bookkeeping to details", () => {
    const body = [
      "_Imported from the Mi review inbox and confirmed 2026-08-16 by Unnamed Mi user. Source: Mi/inbox/1.json (codex)_",
      "",
      "A four-page PDF was exported.",
      "",
      "**Why it was recorded:** It is the printable copy.",
      "",
      "**Evidence**",
      "- 04_Presentation/minutes.pdf",
    ].join("\n");
    const { summary, details } = splitKnowledgeBody(body);
    expect(summary).toBe("A four-page PDF was exported.");
    expect(details).toContain("Mi/inbox/1.json");
    expect(details).toContain("minutes.pdf");
    expect(details).toContain("Why it was recorded");
  });

  it("leaves a hand-written note whole", () => {
    expect(splitKnowledgeBody("- The address is **1002 Example Blvd**.")).toEqual({
      summary: "- The address is **1002 Example Blvd**.",
      details: "",
    });
  });
});
