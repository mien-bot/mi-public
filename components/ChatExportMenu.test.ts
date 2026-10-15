import { describe, expect, it } from "vitest";
import { chatToMarkdown } from "./ChatExportMenu";

describe("chatToMarkdown", () => {
  it("creates Obsidian-compatible Markdown with metadata and messages", () => {
    const markdown = chatToMarkdown({
      id: "one",
      title: "Planning",
      engine: "codex",
      model: "",
      projectSlug: "project-one",
      createdAt: 1,
      updatedAt: 2,
      messages: [{ role: "user", text: "Hello", createdAt: 1 }],
    });
    expect(markdown).toContain("source: Mi");
    expect(markdown).toContain('project: "project-one"');
    expect(markdown).toContain("## You\n\nHello");
  });
});
