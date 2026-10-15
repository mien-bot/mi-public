import { describe, expect, it } from "vitest";
import { personalRecordSchema } from "./schema";
import {
  buildObsidianVaultZip,
  personalRecordToObsidianMarkdown,
  previewObsidianMarkdown,
} from "./obsidian";

describe("Obsidian personal record transfer", () => {
  it("previews Mi frontmatter without treating it as an immediate write", () => {
    const preview = previewObsidianMarkdown({
      name: "Focus plan.md",
      content: `---\ntitle: Focus plan\ntags: [focus, studio]\nmi:\n  kind: plan\n  status: active\n  mood: clear\n---\n\n# Focus plan\n\nProtect the morning.\n`,
    });

    expect(preview.draft).toMatchObject({
      kind: "plan",
      title: "Focus plan",
      body: "Protect the morning.",
      tags: ["focus", "studio"],
      mood: "clear",
      status: "active",
    });
    expect(preview.warnings).toEqual([]);
  });

  it("keeps generic Markdown reviewable without inventing schedule fields", () => {
    const preview = previewObsidianMarkdown({ name: "Loose idea.md", content: "# Loose idea\n\nMaybe later." });
    expect(preview.draft).toMatchObject({ kind: "thought", title: "Loose idea", schedule: null });
    expect(preview.warnings.join(" ")).toMatch(/classification/i);
  });

  it("exports one round-trippable Markdown record and an Obsidian vault zip", async () => {
    const record = personalRecordSchema.parse({
      id: "one", kind: "journal", title: "Morning", body: "Private text", tags: ["daily"], mood: null,
      status: "inbox", schedule: null, share: { status: "local" },
      createdAt: "2026-07-29T12:00:00.000Z", updatedAt: "2026-07-29T12:00:00.000Z",
    });
    const markdown = personalRecordToObsidianMarkdown(record);
    expect(previewObsidianMarkdown({ name: "Morning.md", content: markdown }).draft).toMatchObject({
      kind: "journal", title: "Morning", body: "Private text", tags: ["daily"],
    });
    const zip = await buildObsidianVaultZip([record]);
    expect(zip.size).toBeGreaterThan(100);
  });
});
