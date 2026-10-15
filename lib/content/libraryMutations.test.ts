import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLibraryCollection,
  deleteLibraryCollection,
  deleteLibraryDocument,
  updateLibraryDocumentMetadata,
} from "./libraryMutations";

describe("library metadata mutations", () => {
  let root: string;
  let libraryDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-library-"));
    libraryDir = path.join(root, "library");
    fs.mkdirSync(libraryDir);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("creates a named empty collection and rejects collisions", () => {
    const result = createLibraryCollection({ slug: "reference-details", name: "Reference Details" }, { libraryDir });
    expect(result).toMatchObject({ slug: "reference-details", meta: { name: "Reference Details" } });
    expect(loadYaml(fs.readFileSync(path.join(libraryDir, "reference-details", "index.yaml"), "utf8"))).toEqual([]);
    expect(() => createLibraryCollection(
      { slug: "reference-details", name: "Duplicate" },
      { libraryDir },
    )).toThrow(/already exists/);
  });

  it("edits metadata only, keeps blank values blank, preserves unknown data, and creates a backup", () => {
    const collectionDir = path.join(libraryDir, "references");
    fs.mkdirSync(collectionDir);
    fs.writeFileSync(path.join(collectionDir, "detail.pdf"), "synthetic fixture");
    fs.writeFileSync(path.join(collectionDir, "index.yaml"), dumpYaml([{
      file: "detail.pdf",
      title: "Old",
      tags: [],
      added_date: "2026-07-26",
      future_field: "keep-me",
    }]));

    const result = updateLibraryDocumentMetadata("references", "detail.pdf", {
      title: "",
      tags: ["brick", "wall"],
      source: "",
      notes: "",
    }, { libraryDir });
    const written = loadYaml(fs.readFileSync(result.filePath, "utf8")) as Record<string, unknown>[];
    expect(written[0]).toMatchObject({
      title: "",
      tags: ["brick", "wall"],
      source: "",
      notes: "",
      future_field: "keep-me",
    });
    expect(fs.existsSync(result.backupPath!)).toBe(true);
    expect(fs.readFileSync(path.join(collectionDir, "detail.pdf"), "utf8")).toBe("synthetic fixture");
  });

  it("rejects unsafe paths, unsupported types, and unindexed files", () => {
    const collectionDir = path.join(libraryDir, "references");
    fs.mkdirSync(collectionDir);
    fs.writeFileSync(path.join(collectionDir, "index.yaml"), "[]\n");
    fs.writeFileSync(path.join(root, "outside.pdf"), "fixture");
    fs.writeFileSync(path.join(collectionDir, "script.exe"), "fixture");
    expect(() => updateLibraryDocumentMetadata("references", "../outside.pdf", {}, { libraryDir }))
      .toThrow(/unsafe path segment/);
    expect(() => updateLibraryDocumentMetadata("references", "script.exe", {}, { libraryDir }))
      .toThrow(/Unsupported/);
    fs.writeFileSync(path.join(collectionDir, "not-indexed.pdf"), "fixture");
    expect(() => updateLibraryDocumentMetadata("references", "not-indexed.pdf", { title: "", tags: [] }, { libraryDir }))
      .toThrow(/not indexed/);
  });
});

describe("library deletion", () => {
  let root: string;
  let libraryDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-library-delete-"));
    libraryDir = path.join(root, "library");
    fs.mkdirSync(libraryDir);
    createLibraryCollection({ slug: "reference-details", name: "Reference Details" }, { libraryDir });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function addDocument(file: string) {
    const collectionDir = path.join(libraryDir, "reference-details");
    fs.writeFileSync(path.join(collectionDir, file), "pdf bytes");
    const indexPath = path.join(collectionDir, "index.yaml");
    const current = (loadYaml(fs.readFileSync(indexPath, "utf8")) ?? []) as Record<string, unknown>[];
    fs.writeFileSync(
      indexPath,
      dumpYaml([...current, { file, title: file, tags: [], added_date: "2026-08-01" }]),
      "utf8",
    );
  }

  it("removes a document from disk and from the index together", () => {
    addDocument("detail-a.pdf");
    addDocument("detail-b.pdf");

    const result = deleteLibraryDocument("reference-details", "detail-a.pdf", { libraryDir });

    const collectionDir = path.join(libraryDir, "reference-details");
    expect(fs.existsSync(path.join(collectionDir, "detail-a.pdf"))).toBe(false);
    expect(fs.existsSync(result.backupPath)).toBe(true);
    // Leaving the index row behind would have the next scan resurrect a deleted document.
    const index = loadYaml(fs.readFileSync(path.join(collectionDir, "index.yaml"), "utf8")) as { file: string }[];
    expect(index.map((entry) => entry.file)).toEqual(["detail-b.pdf"]);
  });

  it("refuses a document path that escapes the collection", () => {
    fs.writeFileSync(path.join(root, "secret.pdf"), "nope");
    expect(() => deleteLibraryDocument("reference-details", "../secret.pdf", { libraryDir })).toThrow();
    expect(fs.existsSync(path.join(root, "secret.pdf"))).toBe(true);
  });

  it("deletes a whole collection only against its exact name, and keeps a recoverable copy", () => {
    addDocument("detail-a.pdf");

    expect(() => deleteLibraryCollection("reference-details", { confirmed: true, expectedName: "Wrong Name" }, { libraryDir }))
      .toThrow(/name changed/i);
    expect(() => deleteLibraryCollection("reference-details", { expectedName: "Reference Details" }, { libraryDir }))
      .toThrow(/confirmation/i);
    expect(fs.existsSync(path.join(libraryDir, "reference-details"))).toBe(true);

    const result = deleteLibraryCollection(
      "reference-details",
      { confirmed: true, expectedName: "Reference Details" },
      { libraryDir },
    );

    expect(fs.existsSync(path.join(libraryDir, "reference-details"))).toBe(false);
    expect(fs.existsSync(path.join(result.backupPath, "detail-a.pdf"))).toBe(true);
  });
});
