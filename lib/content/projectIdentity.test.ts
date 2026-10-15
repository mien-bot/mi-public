import { describe, expect, it } from "vitest";
import { projectMetaIdentityMirror, resolveProjectIdentity } from "./projectIdentity";

const meta = {
  address: "STUDIO",
  client: "STUDIO",
  team: [] as { name: string; role: string }[],
};

const details = {
  address: "100 Example St, Chicago, IL",
  client_name: "STUDIO PLLC",
  team: [{ name: "Example User", role: "Strategy" }],
};

describe("resolveProjectIdentity", () => {
  it("prefers the details record over the registry", () => {
    expect(resolveProjectIdentity(meta, details)).toEqual({
      address: "100 Example St, Chicago, IL",
      client: "STUDIO PLLC",
      team: [{ name: "Example User", role: "Strategy" }],
    });
  });

  it("falls back to the registry for anything details leaves blank", () => {
    expect(resolveProjectIdentity(meta, { address: "  ", client_name: "", team: [] })).toEqual({
      address: "STUDIO",
      client: "STUDIO",
      team: [],
    });
  });

  it("uses the registry outright when there is no details record", () => {
    expect(resolveProjectIdentity(meta, null)).toEqual({ address: "STUDIO", client: "STUDIO", team: [] });
  });

  /**
   * The drift this exists to prevent: details.yaml said 100 Example and
   * project.yaml still said "STUDIO", and different Mi surfaces showed different
   * answers for the same project depending on which file they happened to read.
   */
  it("gives one answer no matter which surface asks", () => {
    const fromPage = resolveProjectIdentity(meta, details);
    const fromApi = resolveProjectIdentity(meta, details);
    expect(fromPage).toEqual(fromApi);
  });
});

describe("projectMetaIdentityMirror", () => {
  it("carries populated details values back to the registry", () => {
    expect(projectMetaIdentityMirror(meta, details)).toEqual({
      address: "100 Example St, Chicago, IL",
      client: "STUDIO PLLC",
      team: [{ name: "Example User", role: "Strategy" }],
    });
  });

  it("never blanks the registry from an empty details field", () => {
    expect(projectMetaIdentityMirror(meta, { address: "", client_name: "", team: [] })).toBeNull();
  });

  it("returns null when the two records already agree", () => {
    expect(projectMetaIdentityMirror(
      { address: "100 Example St", client: "STUDIO", team: [{ name: "Example User", role: "Strategy" }] },
      { address: "100 Example St", client_name: "STUDIO", team: [{ name: "Example User", role: "Strategy" }] },
    )).toBeNull();
  });

  it("mirrors only the fields that actually differ", () => {
    expect(projectMetaIdentityMirror(
      { address: "100 Example St", client: "STUDIO", team: [] },
      { address: "100 Example St", client_name: "STUDIO PLLC", team: [] },
    )).toEqual({ client: "STUDIO PLLC" });
  });
});
