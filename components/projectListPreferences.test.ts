import { describe, expect, it } from "vitest";
import { parseProjectListPreferences, DEFAULT_PROJECT_LIST_PREFERENCES } from "./projectListPreferences";

describe("personal project view", () => {
  it("restores valid preferences without storing the search or project data", () => {
    expect(parseProjectListPreferences(JSON.stringify({ status: "all", evidence: "partial", sort: "manual", query: "private" })))
      .toEqual({ status: "all", evidence: "partial", sort: "manual" });
  });
  it("repairs stale or malformed values independently", () => {
    expect(parseProjectListPreferences("invalid")).toEqual(DEFAULT_PROJECT_LIST_PREFERENCES);
    expect(parseProjectListPreferences(null)).toEqual(DEFAULT_PROJECT_LIST_PREFERENCES);
    expect(parseProjectListPreferences('{"status":"removed","sort":"name"}')).toEqual({ status: "active", evidence: "all", sort: "name" });
  });
});
