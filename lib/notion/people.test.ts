import { describe, expect, it } from "vitest";
import { resolveNotionPeopleByName } from "./people";

describe("Notion people resolution", () => {
  it("maps confirmed team names case-insensitively to exact ids", () => {
    expect(resolveNotionPeopleByName(
      ["Example User", "Example Colleague"],
      [{ id: "alex", name: "Example User" }, { id: "taylor", name: "Example Colleague" }],
    )).toEqual(["alex", "taylor"]);
  });

  it("fails closed for missing or ambiguous names", () => {
    expect(() => resolveNotionPeopleByName(
      ["Example User", "Unknown"],
      [{ id: "alex-1", name: "Example User" }, { id: "alex-2", name: "Example User" }],
    )).toThrow(/Review: Example User, Unknown/);
  });

  it("resolves each of two accounts whose names differ only by capitalization", () => {
    // These synthetic accounts differ only by capitalization. Folding case makes
    // them one ambiguous name, and neither could be picked at all.
    const people = [
      { id: "upper", name: "Example Colleague" },
      { id: "lower", name: "example colleague" },
      { id: "alex", name: "Example User" },
    ];
    expect(resolveNotionPeopleByName(["Example Colleague"], people)).toEqual(["upper"]);
    expect(resolveNotionPeopleByName(["example colleague"], people)).toEqual(["lower"]);
    expect(resolveNotionPeopleByName(["  Example Colleague  "], people)).toEqual(["upper"]);
    // A spelling that matches neither exactly is still ambiguous, and still says so.
    expect(() => resolveNotionPeopleByName(["EXAMPLE COLLEAGUE"], people)).toThrow(/must match/i);
  });
});
