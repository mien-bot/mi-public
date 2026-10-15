import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFileWithinDir } from "./fileServing";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mi-file-serving-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveFileWithinDir", () => {
  it("resolves nested files and determines their content type", () => {
    const baseDir = makeTempDir();
    const nestedDir = path.join(baseDir, "drawings");
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(nestedDir, "plan.PDF"), "pdf");

    const result = resolveFileWithinDir(baseDir, ["drawings", "plan.PDF"]);

    expect(result).toEqual({
      ok: true,
      absolutePath: path.join(nestedDir, "plan.PDF"),
      contentType: "application/pdf",
    });
  });

  it("rejects lexical traversal outside the base directory", () => {
    const parentDir = makeTempDir();
    const baseDir = path.join(parentDir, "project");
    fs.mkdirSync(baseDir);
    fs.writeFileSync(path.join(parentDir, "secret.txt"), "secret");

    expect(resolveFileWithinDir(baseDir, ["..", "secret.txt"])).toEqual({
      ok: false,
      status: 400,
      message: "Invalid path",
    });
  });

  it("rejects a symlink or junction that escapes the base directory", () => {
    const parentDir = makeTempDir();
    const baseDir = path.join(parentDir, "project");
    const outsideDir = path.join(parentDir, "outside");
    fs.mkdirSync(baseDir);
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "secret");
    fs.symlinkSync(
      outsideDir,
      path.join(baseDir, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(resolveFileWithinDir(baseDir, ["linked", "secret.txt"])).toEqual({
      ok: false,
      status: 400,
      message: "Invalid path",
    });
  });

  it("allows a symlink or junction whose target stays within the base directory", () => {
    const baseDir = makeTempDir();
    const targetDir = path.join(baseDir, "originals");
    fs.mkdirSync(targetDir);
    fs.writeFileSync(path.join(targetDir, "markup.csv"), "Subject\nDoor\n");
    fs.symlinkSync(
      targetDir,
      path.join(baseDir, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = resolveFileWithinDir(baseDir, ["linked", "markup.csv"]);

    expect(result).toMatchObject({
      ok: true,
      absolutePath: path.join(baseDir, "linked", "markup.csv"),
      contentType: "application/octet-stream",
    });
  });

  it("reports missing paths and directories as not found", () => {
    const baseDir = makeTempDir();
    fs.mkdirSync(path.join(baseDir, "folder"));

    expect(resolveFileWithinDir(baseDir, ["missing.pdf"])).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(resolveFileWithinDir(baseDir, ["folder"])).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});
