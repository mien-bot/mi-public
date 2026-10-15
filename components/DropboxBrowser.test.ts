import { describe, expect, it } from "vitest";
import type { DropboxNode } from "@/lib/content";
import {
  collectDropboxDirectoryPaths,
  countDropboxNodes,
  filterDropboxNodes,
} from "./DropboxBrowser";

const nodes: DropboxNode[] = [
  {
    name: "Drawings",
    relativePath: "Drawings",
    isDirectory: true,
    children: [
      { name: "floor-plan.pdf", relativePath: "Drawings/floor-plan.pdf", isDirectory: false },
      { name: "elevations.pdf", relativePath: "Drawings/elevations.pdf", isDirectory: false },
    ],
  },
  {
    name: "Permits",
    relativePath: "Permits",
    isDirectory: true,
    children: [
      { name: "submission.pdf", relativePath: "Permits/submission.pdf", isDirectory: false },
    ],
  },
];

describe("DropboxBrowser tree helpers", () => {
  it("keeps matching files and their ancestor folders", () => {
    expect(filterDropboxNodes(nodes, "floor")).toEqual([
      {
        ...nodes[0],
        children: [nodes[0].children?.[0]],
      },
    ]);
  });

  it("keeps a complete subtree when its folder name matches", () => {
    expect(filterDropboxNodes(nodes, "permits")).toEqual([nodes[1]]);
  });

  it("supports path searches and case-insensitive matching", () => {
    expect(filterDropboxNodes(nodes, "DRAWINGS/ELEV")).toEqual([
      {
        ...nodes[0],
        children: [nodes[0].children?.[1]],
      },
    ]);
  });

  it("counts nodes and collects exSampleRetailble folder paths", () => {
    expect(countDropboxNodes(nodes)).toBe(5);
    expect(collectDropboxDirectoryPaths(nodes)).toEqual(["Drawings", "Permits"]);
  });
});
