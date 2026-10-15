import { describe, expect, it } from "vitest";
import { leadProjectName } from "./leadProjectName";

describe("leadProjectName", () => {
  it.each([
    ["1002 S Example Blvd, Chicago, Illinois 60616", "1002 S Example Blvd"],
    ["1002 S Example Blvd, Chicago, IL, 60616-1234, USA", "1002 S Example Blvd"],
    ["1002 S Example Blvd Chicago Illinois 60616", "1002 S Example Blvd"],
    ["1002 S Example Blvd Chicago, IL 60616", "1002 S Example Blvd"],
    ["123 Main St, Evanston, IL 60201", "123 Main St"],
    ["1002 S Example Blvd\nChicago, Illinois 60616", "1002 S Example Blvd"],
    ["1002 S Example Blvd 60616", "1002 S Example Blvd"],
    ["1002 S Example Blvd", "1002 S Example Blvd"],
    ["123 W Chicago Ave", "123 W Chicago Ave"],
    ["Acme Clinic, Chicago", "Acme Clinic, Chicago"],
    ["Studio 60616", "Studio 60616"],
  ])("converts %s to %s", (name, expected) => {
    expect(leadProjectName(name)).toBe(expected);
  });
});
