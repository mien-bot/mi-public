import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCsvSource } from "./pathSafety";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mi-bluebeam-pathsafety-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveCsvSource", () => {
  it("resolves a CSV directly inside the markups directory", () => {
    const markupsDir = makeTempDir();
    fs.writeFileSync(path.join(markupsDir, "export.csv"), "Sheet\nA-101\n");

    const result = resolveCsvSource(markupsDir, "export.csv");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.absolutePath).toBe(path.join(markupsDir, "export.csv"));
      expect(result.relativePath).toBe("export.csv");
    }
  });

  it("resolves a CSV inside a subdirectory of the markups workspace", () => {
    const markupsDir = makeTempDir();
    fs.mkdirSync(path.join(markupsDir, "originals"));
    fs.writeFileSync(path.join(markupsDir, "originals", "export.csv"), "Sheet\nA-101\n");

    const result = resolveCsvSource(markupsDir, "originals/export.csv");
    expect(result.ok).toBe(true);
  });

  it("rejects a path that escapes the markups workspace via ..", () => {
    const parent = makeTempDir();
    const markupsDir = path.join(parent, "markups");
    fs.mkdirSync(markupsDir);
    fs.writeFileSync(path.join(parent, "outside.csv"), "Sheet\nA-101\n");

    const result = resolveCsvSource(markupsDir, "../outside.csv");
    expect(result.ok).toBe(false);
  });

  it("rejects a path that looks like a Windows absolute path outside the workspace", () => {
    const markupsDir = makeTempDir();
    const result = resolveCsvSource(markupsDir, "C:\\Users\\someone\\Downloads\\export.csv");
    expect(result.ok).toBe(false);
  });

  it("rejects a nonexistent file", () => {
    const markupsDir = makeTempDir();
    const result = resolveCsvSource(markupsDir, "missing.csv");
    expect(result.ok).toBe(false);
  });
});
