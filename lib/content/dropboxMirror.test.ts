import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  project: { slug: "demo", meta: { dropbox_path: "1.00 PROJECTS/Demo", content_location: "local" } },
}));

vi.mock("./projects", () => ({ getProject: () => mocks.project }));
// Deterministic regardless of this machine's real .env.local DROPBOX_ROOT.
vi.mock("./paths", () => ({ DROPBOX_ROOT: "C:\\Dropbox\\STUDIO", PROJECTS_DIR: "C:\\repo\\projects" }));

import {
  mirrorProjectKnowledge,
  planProjectKnowledgeMirror,
  resolveConfirmedProjectDir,
} from "./dropboxMirror";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mi-dropbox-mirror-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("mirrorProjectKnowledge", () => {
  it("short-circuits once a project has migrated to Dropbox-shared storage", () => {
    mocks.project.meta.content_location = "dropbox";
    const result = mirrorProjectKnowledge("demo");
    expect(result).toEqual({ mirrored: false, reason: "already-shared" });
  });

  it("reports not-linked when the project has no dropbox_path, before checking migration state", () => {
    mocks.project.meta.content_location = "local";
    mocks.project.meta.dropbox_path = null as unknown as string;
    const result = mirrorProjectKnowledge("demo");
    expect(result).toEqual({ mirrored: false, reason: "not-linked" });
  });
});

describe("confirmed Dropbox mirror destination", () => {
  it("requires the human-confirmed project folder to exist", () => {
    const dropboxRoot = makeTempDir();

    expect(() =>
      resolveConfirmedProjectDir(dropboxRoot, "1.00 PROJECTS/Missing"),
    ).toThrow(/existing directory/);
    expect(fs.existsSync(path.join(dropboxRoot, "1.00 PROJECTS", "Missing"))).toBe(false);
  });

  it("resolves an existing project folder inside Dropbox", () => {
    const dropboxRoot = makeTempDir();
    const projectDir = path.join(dropboxRoot, "1.00 PROJECTS", "Demo");
    fs.mkdirSync(projectDir, { recursive: true });

    expect(resolveConfirmedProjectDir(dropboxRoot, "1.00 PROJECTS/Demo"))
      .toBe(fs.realpathSync.native(projectDir));
  });

  it("rejects traversal and a junction that resolves outside Dropbox", () => {
    const parent = makeTempDir();
    const dropboxRoot = path.join(parent, "Dropbox");
    const outside = path.join(parent, "Outside");
    fs.mkdirSync(dropboxRoot);
    fs.mkdirSync(outside);
    fs.symlinkSync(
      outside,
      path.join(dropboxRoot, "Linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() => resolveConfirmedProjectDir(dropboxRoot, "../Outside"))
      .toThrow(/escapes DROPBOX_ROOT/);
    expect(() => resolveConfirmedProjectDir(dropboxRoot, "Linked"))
      .toThrow(/escapes DROPBOX_ROOT/);
  });
});

describe("marker-owned project snapshot planning", () => {
  it("targets Mi/project-compatible generated files and excludes user-authored memory", () => {
    const root = makeTempDir();
    const source = path.join(root, "source");
    const destination = path.join(root, "Mi", "project");
    fs.mkdirSync(path.join(source, "memory"), { recursive: true });
    fs.writeFileSync(path.join(source, "project.yaml"), "name: Demo\n");
    fs.writeFileSync(path.join(source, "memory", "notes.md"), "# private agent history\n");

    const plan = planProjectKnowledgeMirror(source, destination);
    expect(plan.entries.map((entry) => entry.relativePath)).toEqual(["project.yaml"]);
    expect(plan.entries[0]).toMatchObject({ action: "create", destinationHash: null });
    expect(plan.entries[0].content).toBe("<!-- mi-generated:harness-v1 -->\nname: Demo\n");
  });

  it("updates only marker-owned files and flags user-authored destinations as conflicts", () => {
    const root = makeTempDir();
    const source = path.join(root, "source");
    const destination = path.join(root, "Mi", "project");
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(source, "safe.md"), "# New\n");
    fs.writeFileSync(path.join(source, "protected.md"), "# Source\n");
    fs.writeFileSync(
      path.join(destination, "safe.md"),
      "<!-- mi-generated:harness-v1 -->\n# Old\n",
    );
    fs.writeFileSync(path.join(destination, "protected.md"), "# Human edit\n");

    const plan = planProjectKnowledgeMirror(source, destination);
    expect(plan.entries.find((entry) => entry.relativePath === "safe.md")?.action).toBe("update");
    expect(plan.entries.find((entry) => entry.relativePath === "protected.md")?.action).toBe("conflict");
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].relativePath).toBe("protected.md");
  });
});
