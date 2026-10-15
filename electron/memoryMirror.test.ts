import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

interface MirrorResult {
  mirrored: boolean;
  destination?: string;
  reason?: string;
  fileCount?: number;
}

const require = createRequire(import.meta.url);
const { mirrorProjectMemory } = require("./memoryMirror.js") as {
  mirrorProjectMemory(options: {
    repoRoot: string;
    projectSlug: string;
    dropboxRoot: string | null;
    logger?: { log(message: string): void; error(message: string): void };
  }): MirrorResult;
};

const testRoot = path.join(process.cwd(), ".tmp", "memory-mirror-tests");
const repoRoot = path.join(testRoot, "repo");
const dropboxRoot = path.join(testRoot, "dropbox");

function writeProject(dropboxPath: string | null, notes = "Remember this.\n") {
  const projectDir = path.join(repoRoot, "projects", "demo");
  fs.mkdirSync(path.join(projectDir, "memory"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "project.yaml"),
    `name: Demo\ndropbox_path: ${dropboxPath === null ? "null" : JSON.stringify(dropboxPath)}\n`,
    "utf8",
  );
  fs.writeFileSync(path.join(projectDir, "memory", "notes.md"), notes, "utf8");
}

beforeEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.mkdirSync(dropboxRoot, { recursive: true });
});

afterAll(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe("mirrorProjectMemory", () => {
  it("copies all project text knowledge into the linked project's Mi folder", () => {
    writeProject("1.00 PROJECTS/Demo");

    const result = mirrorProjectMemory({ repoRoot, projectSlug: "demo", dropboxRoot });

    expect(result.mirrored).toBe(true);
    expect(fs.readFileSync(path.join(dropboxRoot, "1.00 PROJECTS", "Demo", "Mi", "memory", "notes.md"), "utf8"))
      .toBe("Remember this.\n");
    // Exactly one notes.md: a second copy at the Mi/ root is not refreshed by the writer that
    // applies memory-note cards, so it can only go stale and mislead.
    expect(fs.existsSync(path.join(dropboxRoot, "1.00 PROJECTS", "Demo", "Mi", "notes.md")))
      .toBe(false);
    expect(fs.existsSync(path.join(dropboxRoot, "1.00 PROJECTS", "Demo", "Mi", "project.yaml")))
      .toBe(true);
  });

  it("does nothing when the project is not linked", () => {
    writeProject(null);

    expect(mirrorProjectMemory({ repoRoot, projectSlug: "demo", dropboxRoot }))
      .toEqual({ mirrored: false, reason: "not-linked" });
  });

  it("rejects a dropbox_path that escapes DROPBOX_ROOT", () => {
    writeProject("../outside");
    const errors: string[] = [];

    const result = mirrorProjectMemory({
      repoRoot,
      projectSlug: "demo",
      dropboxRoot,
      logger: { log() {}, error(message) { errors.push(message); } },
    });

    expect(result).toEqual({ mirrored: false, reason: "error" });
    expect(errors[0]).toMatch(/escapes DROPBOX_ROOT/);
  });
});
