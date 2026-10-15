import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-detect-conflicts-"));
  roots.push(root);
  return root;
}

let projectsDir: string;
vi.mock("@/lib/content/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/content/paths")>();
  return {
    ...actual,
    get REPO_ROOT() { return path.dirname(projectsDir); },
    get PROJECTS_DIR() { return projectsDir; },
  };
});

import { deleteProject, detectProjectConflicts, getProjectWithHash, getSchedule, writeProjectMeta } from "./projects";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  const root = temporaryRoot();
  projectsDir = path.join(root, "projects");
  fs.mkdirSync(path.join(projectsDir, "demo", "schedule"), { recursive: true });
  fs.writeFileSync(
    path.join(projectsDir, "demo", "project.yaml"),
    "name: Demo\naddress: \"\"\nclient: \"\"\nstatus: in-progress\n",
    "utf8",
  );
});

describe("detectProjectConflicts", () => {
  it("excludes archived deadlines from ordinary readers while retaining them for mutations", () => {
    fs.writeFileSync(path.join(projectsDir, "demo", "schedule", "schedule.yaml"), JSON.stringify({ milestones: [
      { id: "active", name: "Active", planned_date: "2026-01-01", actual_date: null },
      { id: "archived", name: "Archived", planned_date: "2026-01-01", actual_date: null, archived_at: "2026-09-29T00:00:00.000Z" },
    ] }));
    expect(getSchedule("demo").milestones.map((item) => item.id)).toEqual(["active"]);
    expect(getSchedule("demo", { includeArchived: true }).milestones.map((item) => item.id)).toEqual(["active", "archived"]);
  });
  it("returns [] when nothing is conflicted", () => {
    fs.writeFileSync(path.join(projectsDir, "demo", "schedule", "schedule.yaml"), "milestones: []\n", "utf8");
    expect(detectProjectConflicts("demo")).toEqual([]);
  });

  it("finds a conflicted-copy file under the project's local content root", () => {
    fs.writeFileSync(
      path.join(projectsDir, "demo", "schedule", "schedule (Partner's conflicted copy 2026-07-26).yaml"),
      "milestones: []\n",
      "utf8",
    );
    const conflicts = detectProjectConflicts("demo");
    expect(conflicts).toEqual([
      expect.objectContaining({ name: "schedule (Partner's conflicted copy 2026-07-26).yaml" }),
    ]);
  });
});

describe("project metadata concurrency", () => {
  it("returns a hash from the exact metadata snapshot and blocks a stale write", () => {
    const loaded = getProjectWithHash("demo");
    writeProjectMeta("demo", { ...loaded.project.meta, client: "Partner one" }, { expectedHash: loaded.hash });
    expect(() => writeProjectMeta("demo", { ...loaded.project.meta, client: "Partner two" }, { expectedHash: loaded.hash }))
      .toThrow(/changed since it was last read/i);
    expect(getProjectWithHash("demo").project.meta.client).toBe("Partner one");
  });
});

describe("deleteProject", () => {
  it("removes Mi's project folder only against the exact name, and keeps a recoverable copy", () => {
    fs.writeFileSync(
      path.join(projectsDir, "demo", "schedule", "schedule.yaml"),
      "milestones: []\n",
      "utf8",
    );

    expect(() => deleteProject("demo", { expectedName: "Demo" }))
      .toThrow(/confirmation/i);
    expect(() => deleteProject("demo", { confirmed: true, expectedName: "Wrong" }))
      .toThrow(/name changed/i);
    expect(fs.existsSync(path.join(projectsDir, "demo"))).toBe(true);

    const result = deleteProject("demo", { confirmed: true, expectedName: "Demo" });

    expect(fs.existsSync(path.join(projectsDir, "demo"))).toBe(false);
    expect(fs.existsSync(path.join(result.backupPath, "schedule", "schedule.yaml"))).toBe(true);
    expect(result.dropboxContentLeftInPlace).toBe(false);
  });

  it("never touches a Dropbox-hosted content folder, and says so", () => {
    const dropboxContent = path.join(path.dirname(projectsDir), "dropbox-content");
    fs.mkdirSync(dropboxContent, { recursive: true });
    fs.writeFileSync(path.join(dropboxContent, "drawings.pdf"), "real project archive", "utf8");
    fs.writeFileSync(
      path.join(projectsDir, "demo", "project.yaml"),
      [
        "name: Demo",
        'address: ""',
        'client: ""',
        "status: in-progress",
        "content_location: dropbox",
        "dropbox_path: Clients/Demo",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = deleteProject("demo", { confirmed: true, expectedName: "Demo" });

    // Mi's own record is gone; the real project archive is emphatically not Mi's to destroy.
    expect(fs.existsSync(path.join(projectsDir, "demo"))).toBe(false);
    expect(fs.existsSync(path.join(dropboxContent, "drawings.pdf"))).toBe(true);
    expect(result.dropboxContentLeftInPlace).toBe(true);
  });

  it("reports an unknown project rather than deleting anything", () => {
    expect(() => deleteProject("not-a-project", { confirmed: true, expectedName: "Demo" }))
      .toThrow(/was not found/);
    expect(fs.existsSync(path.join(projectsDir, "demo"))).toBe(true);
  });
});
