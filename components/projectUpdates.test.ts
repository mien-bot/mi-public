import { describe, expect, it } from "vitest";
import { markProjectSeen, parseSeenProject, projectUpdates } from "./projectUpdates";
import type { ProjectChange } from "@/lib/content/projectDiscoveryTypes";
const item = (revision: string): ProjectChange => ({ id: "dropbox:Mi/outputs/report.pdf", revision, label: "Report", kind: "file", href: "/file" });
describe("project read state", () => {
  it("starts without an unread storm and highlights changed bytes", () => {
    expect(projectUpdates([item("one")], null)).toEqual([]);
    const baseline = markProjectSeen([item("one")], null);
    expect(projectUpdates([item("two")], baseline)).toHaveLength(1);
  });
  it("only acknowledges the displayed revision, retaining unseen arrivals", () => {
    const seen = markProjectSeen([item("one")], null);
    const reviewed = markProjectSeen([item("two")], seen);
    expect(projectUpdates([item("three")], reviewed)).toHaveLength(1);
    expect(markProjectSeen([], reviewed)).toEqual(reviewed);
  });
  it("recovers corrupt stored state", () => {
    expect(parseSeenProject("garbage")).toBeNull();
    expect(parseSeenProject('{"version":1,"revisions":{"a":4}}')).toBeNull();
  });
  it("reports removals only after a complete scan and detects restored files", () => {
    const baseline = markProjectSeen([item("one")], null);
    expect(projectUpdates([], baseline, false)).toEqual([]);
    const removed = projectUpdates([], baseline, true);
    expect(removed[0].label).toContain("No longer present");
    const reviewed = markProjectSeen(removed, baseline);
    expect(projectUpdates([], reviewed, true)).toEqual([]);
    expect(projectUpdates([item("one")], reviewed, true)).toHaveLength(1);
  });
});
