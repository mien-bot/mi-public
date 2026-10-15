import { describe, expect, it } from "vitest";
import { projectDetailsSchema } from "@/lib/schema";
import { projectDetailsChanges } from "./projectDetailsChanges";

describe("project details review", () => {
  it("shows every changed field including removals and nested people and phases", () => {
    const before = projectDetailsSchema.parse({ scope: "Old scope", client_contacts: [{ name: "Lee" }] });
    const after = projectDetailsSchema.parse({ scope: "Revised scope", address: "123 Main St", phases: [{ id: "phase-one", name: "Design" }] });
    const changes = projectDetailsChanges(before, after);
    expect(changes.map(item => item.key)).toEqual(["address", "scope", "client_contacts", "phases"]);
    expect(changes.find(item => item.key === "client_contacts")?.after).toBe("Not recorded");
    expect(changes.find(item => item.key === "scope")).toMatchObject({ before: "Old scope", after: "Revised scope" });
    expect(changes.find(item => item.key === "phases")?.after).toContain("Design");
    expect(changes.find(item => item.key === "phases")?.after).not.toContain("phase-one");
  });
  it("has no changes for an untouched draft", () => {
    const details = projectDetailsSchema.parse({});
    expect(projectDetailsChanges(details, structuredClone(details))).toEqual([]);
  });
});
