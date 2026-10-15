import { describe, expect, it } from "vitest";
import { projectGlyph, projectInitials } from "./ProjectIdentity";
describe("projectInitials", () => {
  it.each([
    ["26_0805_Studio Marketing", "SM"], ["26_0804_ABC Clinic", "AC"],
    ["23-000-Retail Center", "RC"], ["24-002 Shop Survey", "SS"],
    ["25_1111_1002 S Example", "SE"], ["26_1000 W Example Blvd", "WE"],
    ["25-001-Meadow", "M"], ["00_Admin", "A"], ["25_1206", "25"], ["", "MI"],
  ])("derives initials for %s", (name, expected) => { expect(projectInitials(name)).toBe(expected); });
});
describe("projectGlyph", () => {
  it("keeps short single words and uses initials for multiword names", () => {
    expect(projectGlyph("25-001-Meadow")).toEqual({ text: "Meadow", kind: "word" });
    expect(projectGlyph("00_Admin", true)).toEqual({ text: "Admin", kind: "word" });
    expect(projectGlyph("26_0805_Studio Marketing")).toEqual({ text: "SM", kind: "initials" });
  });
  it("uses initials when a single word does not fit", () => {
    expect(projectGlyph("25-001-Greenfield", true)).toEqual({ text: "G", kind: "initials" });
    expect(projectGlyph("26_001_Reconstruction")).toEqual({ text: "R", kind: "initials" });
  });
});
