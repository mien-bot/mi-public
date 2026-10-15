import { describe, expect, it } from "vitest";
import {
  classifyKnowledgeSection,
  readProjectKnowledge,
  searchKnowledgeEntries,
  sortKnowledgeEntries,
} from "./projectKnowledge";
import type { ProjectMemory } from "./projectWorkspace";

function memory(sections: { title: string; body: string }[]): ProjectMemory {
  return { lastUpdated: "2026-08-26", sections, preamble: "", relativePath: "memory/notes.md" };
}

describe("project knowledge", () => {
  it("reads the kind and date out of the heading Mi writes", () => {
    const entry = classifyKnowledgeSection(
      { title: "fact note — 2026-08-26 — Restaurant has separate exits", body: "Owner confirmed it." },
      0,
    );
    expect(entry).toMatchObject({
      group: "facts",
      entryKind: "fact",
      date: "2026-08-26",
      title: "Restaurant has separate exits",
    });
    // The original heading survives, so the line is still findable in the file itself.
    expect(entry.heading).toBe("fact note — 2026-08-26 — Restaurant has separate exits");
  });

  it("maps every entry kind Mi records onto a group", () => {
    const kinds: [string, string][] = [
      ["meeting", "meetings"],
      ["decision", "decisions"],
      ["action", "actions"],
      ["risk", "risks"],
      ["fact", "facts"],
      ["open-question", "facts"],
      ["lesson", "facts"],
      ["record-change", "record-changes"],
      ["reference", "references"],
    ];
    for (const [kind, group] of kinds) {
      const heading = kind === "meeting" ? "Meeting note" : `${kind} note`;
      expect(classifyKnowledgeSection({ title: `${heading} — 2026-08-26 — T`, body: "" }, 0).group).toBe(group);
    }
  });

  it("leaves a hand-written heading unclassified rather than guessing", () => {
    // "Cafe is a serving counter with no cooking" is a real heading from a real project.
    // Reading a kind out of prose would be inventing metadata, and a wrong kind files the
    // note somewhere nobody will look for it.
    const entry = classifyKnowledgeSection({ title: "Cafe is a serving counter with no cooking", body: "x" }, 3);
    expect(entry).toMatchObject({ group: "general", entryKind: null, date: null });
    expect(entry.title).toBe("Cafe is a serving counter with no cooking");
  });

  it("does not classify a heading that merely contains the word note", () => {
    expect(classifyKnowledgeSection({ title: "A note about the cafe", body: "" }, 0).group).toBe("general");
    expect(classifyKnowledgeSection({ title: "fact note — Restaurant exits", body: "" }, 0).group).toBe("general");
  });

  it("counts every group, including the empty ones", () => {
    const knowledge = readProjectKnowledge(memory([
      { title: "fact note — 2026-08-26 — A", body: "" },
      { title: "risk note — 2026-08-25 — B", body: "" },
      { title: "Hand written", body: "" },
    ]));
    expect(knowledge?.total).toBe(3);
    expect(knowledge?.counts).toMatchObject({ facts: 1, risks: 1, general: 1, meetings: 0, decisions: 0 });
  });

  it("returns null when a project has no notes file at all", () => {
    expect(readProjectKnowledge(null)).toBeNull();
  });

  it("sorts newest first and keeps undated entries below dated ones", () => {
    const entries = readProjectKnowledge(memory([
      { title: "Hand written", body: "" },
      { title: "fact note — 2026-08-20 — older", body: "" },
      { title: "fact note — 2026-08-26 — newer", body: "" },
    ]))!.entries;
    expect(sortKnowledgeEntries(entries).map((entry) => entry.title))
      .toEqual(["newer", "older", "Hand written"]);
  });

  it("searches titles and bodies", () => {
    const entries = readProjectKnowledge(memory([
      { title: "fact note — 2026-08-26 — Egress", body: "Restaurant has its own exits." },
      { title: "risk note — 2026-08-25 — Sprinklers", body: "Section 903.2.1.7 may not apply." },
    ]))!.entries;
    expect(searchKnowledgeEntries(entries, "egress").map((entry) => entry.title)).toEqual(["Egress"]);
    expect(searchKnowledgeEntries(entries, "903.2").map((entry) => entry.title)).toEqual(["Sprinklers"]);
    expect(searchKnowledgeEntries(entries, "  ")).toHaveLength(2);
  });
});
