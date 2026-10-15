import { describe, expect, it } from "vitest";
import { parseReviewArgs, resolveSharedDestination } from "./review";
import type { ReviewCardView } from "@/lib/content/reviewInboxService";

function view(destinations: { kind: string; available: boolean }[]): ReviewCardView {
  return {
    destinations: destinations.map((entry) => ({
      ref: { kind: entry.kind, record: `${entry.kind}.md`, field: "" },
      label: entry.kind,
      record: `${entry.kind}.md`,
      mode: "append",
      current: "",
      proposed: "",
      available: entry.available,
      unavailableReason: entry.available ? "" : "not linked",
      audience: "internal",
    })),
  } as unknown as ReviewCardView;
}

describe("mi review", () => {
  it("parses a workspace, card ids, and the explicit confirmation flag", () => {
    expect(parseReviewArgs(["confirm", "--project", "samplestudio", "--all", "--yes"])).toMatchObject({
      action: "confirm",
      workspace: { kind: "project", slug: "samplestudio" },
      all: true,
      confirmed: true,
    });
    expect(parseReviewArgs(["confirm", "--lead", "sample-play", "--card", "entry-1", "--card", "entry-2"]))
      .toMatchObject({ workspace: { kind: "lead", slug: "sample-play" }, cardIds: ["entry-1", "entry-2"], confirmed: false });
    expect(parseReviewArgs(["list"])).toMatchObject({ action: "list", workspace: null });
  });

  it("refuses an ambiguous or unusable confirm", () => {
    expect(() => parseReviewArgs(["confirm", "--all"])).toThrow(/--project, --lead, or --qaqc/);
    expect(() => parseReviewArgs(["confirm", "--project", "a", "--all", "--card", "entry-1"]))
      .toThrow(/--all or --card, not both/);
    expect(() => parseReviewArgs(["confirm", "--project", "a"])).toThrow(/--all or at least one --card/);
    expect(() => parseReviewArgs(["confirm", "--project", "Not A Slug", "--all"])).toThrow(/valid workspace slug/);
    expect(() => parseReviewArgs(["confirm", "--project", "a", "--lead", "b", "--all"])).toThrow(/exactly one workspace/);
    expect(() => parseReviewArgs(["confirm", "--project", "a", "--all", "--destination", "nowhere"]))
      .toThrow(/--destination must be one of/);
    expect(() => parseReviewArgs(["apply"])).toThrow(/mi review list.*mi review confirm/);
  });

  it("treats no arguments and --help as a request for help", () => {
    expect(parseReviewArgs([]).help).toBe(true);
    expect(parseReviewArgs(["confirm", "--project", "a", "--all", "--help"]).help).toBe(true);
  });

  it("offers only a destination every selected card can reach", () => {
    const shared = resolveSharedDestination([
      view([{ kind: "project-notes", available: true }, { kind: "project-meeting", available: true }]),
      view([{ kind: "project-notes", available: true }, { kind: "project-meeting", available: false }]),
    ]);
    expect(shared.choices.map((choice) => choice.kind)).toEqual(["project-notes"]);
    expect(shared.destination).toBe("project-notes");
  });

  it("makes the person choose when a set shares more than one destination", () => {
    const shared = resolveSharedDestination([
      view([{ kind: "project-notes", available: true }, { kind: "project-meeting", available: true }]),
      view([{ kind: "project-notes", available: true }, { kind: "project-meeting", available: true }]),
    ]);
    expect(shared.choices).toHaveLength(2);
    // Null rather than a first-match guess: two destinations mean two different writes.
    expect(shared.destination).toBeNull();
  });

  it("reports no shared destination rather than picking one that some card cannot reach", () => {
    const shared = resolveSharedDestination([
      view([{ kind: "project-notes", available: true }]),
      view([{ kind: "project-meeting", available: true }]),
    ]);
    expect(shared.choices).toEqual([]);
    expect(shared.destination).toBeNull();
  });
});
