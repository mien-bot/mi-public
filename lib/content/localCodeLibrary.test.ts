import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getLocalCodeLibraryIndex,
  LEGACY_CODE_LIBRARY_RELATIVE_PATH,
  LOCAL_CODE_LIBRARY_ENV,
  resolveLocalCodeLibraryFile,
} from "./localCodeLibrary";

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mi-code-library-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("local code library index", () => {
  it("indexes supported documents from a configured root without reading content", () => {
    const root = makeTemporaryDirectory();
    fs.mkdirSync(path.join(root, "Chicago"));
    fs.writeFileSync(path.join(root, "Chicago", "building-code.pdf"), "fixture");
    fs.writeFileSync(path.join(root, "permit.doc"), "fixture");
    fs.writeFileSync(path.join(root, "archive.zip"), "not indexed");
    fs.writeFileSync(path.join(root, ".hidden.pdf"), "not indexed");

    const index = getLocalCodeLibraryIndex({
      env: { [LOCAL_CODE_LIBRARY_ENV]: root },
      repoRoot: makeTemporaryDirectory(),
    });

    expect(index).toMatchObject({
      available: true,
      source: "environment",
      documentCount: 2,
      totalBytes: 14,
      truncated: false,
    });
    expect(index.available && index.nodes).toEqual([
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
            sizeBytes: 7,
          },
        ],
      },
      {
        kind: "file",
        name: "permit.doc",
        relativePath: "permit.doc",
        extension: ".doc",
        sizeBytes: 7,
      },
    ]);
  });

  it("uses the ignored legacy copy only when no root is configured", () => {
    const repoRoot = makeTemporaryDirectory();
    const legacyRoot = path.join(repoRoot, LEGACY_CODE_LIBRARY_RELATIVE_PATH);
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, "reference.pdf"), "fixture");

    expect(getLocalCodeLibraryIndex({ env: {}, repoRoot })).toMatchObject({
      available: true,
      source: "legacy-copy",
      documentCount: 1,
    });
  });

  it("reports a configured but missing source without falling back silently", () => {
    const repoRoot = makeTemporaryDirectory();
    const legacyRoot = path.join(repoRoot, LEGACY_CODE_LIBRARY_RELATIVE_PATH);
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, "reference.pdf"), "fixture");

    expect(
      getLocalCodeLibraryIndex({
        env: { [LOCAL_CODE_LIBRARY_ENV]: path.join(repoRoot, "missing") },
        repoRoot,
      }),
    ).toEqual({
      available: false,
      message: `${LOCAL_CODE_LIBRARY_ENV} is configured, but its directory cannot be read.`,
    });
  });
});

describe("local code document resolution", () => {
  it("resolves an allowed document contained by the configured root", () => {
    const root = makeTemporaryDirectory();
    fs.mkdirSync(path.join(root, "Chicago"));
    const filePath = path.join(root, "Chicago", "code.pdf");
    fs.writeFileSync(filePath, "fixture");

    expect(
      resolveLocalCodeLibraryFile(["Chicago", "code.pdf"], {
        env: { [LOCAL_CODE_LIBRARY_ENV]: root },
      }),
    ).toEqual({
      ok: true,
      absolutePath: fs.realpathSync(filePath),
      contentType: "application/pdf",
      fileName: "code.pdf",
    });
  });

  it("rejects traversal and unsupported file types", () => {
    const root = makeTemporaryDirectory();
    fs.writeFileSync(path.join(root, "archive.zip"), "fixture");
    const options = { env: { [LOCAL_CODE_LIBRARY_ENV]: root } };

    expect(resolveLocalCodeLibraryFile(["..", "outside.pdf"], options)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(resolveLocalCodeLibraryFile(["archive.zip"], options)).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});
