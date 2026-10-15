import { describe, expect, it } from "vitest";
import type { LocalCodeLibraryNode } from "@/lib/content/localCodeLibrary";
import {
  collectCodeLibraryDirectoryPaths,
  countCodeLibraryDocuments,
  filterCodeLibraryNodes,
} from "./CodeLibraryBrowser";

const nodes: LocalCodeLibraryNode[] = [
  {
    kind: "directory",
    name: "Chicago",
    relativePath: "Chicago",
    children: [
      {
        kind: "file",
        name: "building-code.pdf",
        relativePath: "Chicago/building-code.pdf",
        extension: ".pdf",
        sizeBytes: 1024,
      },
    ],
  },
  {
    kind: "file",
    name: "state-accessibility.doc",
    relativePath: "state-accessibility.doc",
    extension: ".doc",
    sizeBytes: 512,
  },
];

describe("CodeLibraryBrowser tree helpers", () => {
  it("keeps matching files and their ancestor folders", () => {
    const chicago = nodes[0] as Extract<LocalCodeLibraryNode, { kind: "directory" }>;
    expect(filterCodeLibraryNodes(nodes, "building")).toEqual([
      { ...chicago, children: [chicago.children[0]] },
    ]);
  });

  it("supports case-insensitive folder and path searches", () => {
    expect(filterCodeLibraryNodes(nodes, "CHICAGO")).toEqual([nodes[0]]);
    expect(filterCodeLibraryNodes(nodes, "chicago/building")).toEqual([nodes[0]]);
  });

  it("counts documents and collects exSampleRetailble folder paths", () => {
    expect(countCodeLibraryDocuments(nodes)).toBe(2);
    expect(collectCodeLibraryDirectoryPaths(nodes)).toEqual(["Chicago"]);
  });
});
