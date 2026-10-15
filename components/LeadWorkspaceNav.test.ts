import { describe, expect, it } from "vitest";
import {
  LEAD_DAILY_ITEMS,
  LEAD_MORE_ITEMS,
  leadWorkspaceActiveSuffix,
} from "./LeadWorkspaceNav";

describe("LeadWorkspaceNav", () => {
  it("keeps Terminal with the frequent destinations and retains every specialist destination", () => {
    expect(LEAD_DAILY_ITEMS.map(([label]) => label)).toEqual([
      "Overview",
      "Talk to Mi",
      "Meetings",
      "Contracts",
      "Terminal",
    ]);
    expect(LEAD_MORE_ITEMS.map(([label]) => label)).toEqual([
      "Analysis",
      "Owner-supplied",
      "Dropbox files",
    ]);
  });

  it("derives active state from the current lead route without crossing into another lead", () => {
    expect(leadWorkspaceActiveSuffix("/leads/demo", "demo")).toBe("");
    expect(leadWorkspaceActiveSuffix("/leads/demo/contracts", "demo")).toBe("/contracts");
    expect(leadWorkspaceActiveSuffix("/leads/demo/dropbox/folder", "demo")).toBe("/dropbox");
    expect(leadWorkspaceActiveSuffix("/leads/other/contracts", "demo")).toBe("");
  });
});
