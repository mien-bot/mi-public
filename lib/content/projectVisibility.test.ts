import { describe, expect, it } from "vitest";
import { isActiveProjectStatus, isPortfolioProject } from "./projectVisibility";

describe("project visibility", () => {
  it("treats only in-progress work as active", () => {
    expect(isActiveProjectStatus("in-progress")).toBe(true);
    expect(isActiveProjectStatus("not-started")).toBe(false);
    expect(isActiveProjectStatus("complete")).toBe(false);
    expect(isActiveProjectStatus("abandoned")).toBe(false);
  });

  it("excludes the administrative record from project-facing views", () => {
    expect(isPortfolioProject({ slug: "example-project-18", name: "example-record-17" })).toBe(false);
    expect(isPortfolioProject({ slug: null, name: "ADMIN" })).toBe(false);
    expect(isPortfolioProject({ slug: null, name: "00 Admin" })).toBe(false);
  });

  it("does not hide real projects that merely contain the word admin", () => {
    expect(
      isPortfolioProject({
        slug: "26-010-admin-office-renovation",
        name: "Admin Office Renovation",
      }),
    ).toBe(true);
  });
});
