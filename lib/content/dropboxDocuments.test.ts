import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverDocumentFolderFiles, discoverDropboxDocuments } from "./dropboxDocuments";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-dropbox-documents-"));
  roots.push(root);
  return root;
}

describe("Dropbox document discovery", () => {
  it("finds generic filenames inside a category folder and matching filenames elsewhere", () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, "02 Contracts"));
    fs.writeFileSync(path.join(root, "02 Contracts", "signed.pdf"), "not read by discovery");
    fs.writeFileSync(path.join(root, "Owner Architect Agreement.docx"), "not read by discovery");
    fs.writeFileSync(path.join(root, "unrelated.pdf"), "not read by discovery");

    expect(discoverDropboxDocuments(root, "contracts").map((entry) => entry.relativePath).sort()).toEqual([
      "02 Contracts/signed.pdf",
      "Owner Architect Agreement.docx",
    ].sort());
  });

  it("does not follow symbolic links or return hidden files", () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, "Contracts"));
    fs.writeFileSync(path.join(root, "Contracts", ".private.pdf"), "hidden");
    expect(discoverDropboxDocuments(root, "contracts")).toEqual([]);
  });

  it("shows files placed beside an index without treating the index or archive as documents", () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, "archive"));
    fs.writeFileSync(path.join(root, "index.yaml"), "[]\n");
    fs.writeFileSync(path.join(root, "new-contract.pdf"), "file");
    fs.writeFileSync(path.join(root, "archive", "old-contract.pdf"), "file");

    expect(discoverDocumentFolderFiles(root).map((entry) => entry.relativePath)).toEqual(["new-contract.pdf"]);
  });
});
