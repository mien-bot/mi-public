import { describe, expect, it } from "vitest";
import { buildStudioProjectProperties } from "./studioProjects";

describe("Studio Projects creation properties", () => {
  it("writes only explicitly selected project classifications and scopes", () => {
    expect(buildStudioProjectProperties({
      name: "Residence",
      status: "not-started",
      client: "Owner",
      location: "Chicago",
      projectTypes: ["Residential"],
      scopes: ["SD", "DD", "CD"],
    })).toMatchObject({
      Name: { title: [{ text: { content: "Residence" } }] },
      Status: { status: { name: "Not Started" } },
      "Project Type": { multi_select: [{ name: "Residential" }] },
      Scope: { multi_select: [{ name: "SD" }, { name: "DD" }, { name: "CD" }] },
    });
  });

  it("keeps blank classification metadata blank", () => {
    const properties = buildStudioProjectProperties({
      name: "Unclassified project",
      status: "not-started",
      projectTypes: [],
      scopes: [],
    });
    expect(properties).not.toHaveProperty("Project Type");
    expect(properties).not.toHaveProperty("Scope");
  });
});
