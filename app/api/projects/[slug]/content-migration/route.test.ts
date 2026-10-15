import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-content-migration-route-"));
  roots.push(root);
  return root;
}

const mocks = vi.hoisted(() => ({
  project: {
    slug: "demo",
    meta: { dropbox_path: null as string | null, content_location: "local" as "local" | "dropbox" },
  },
}));

vi.mock("@/lib/content", () => ({
  getProjectSlugs: () => ["demo"],
  getProject: () => mocks.project,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/audit/log", () => ({ recordAudit: vi.fn() }));

let dropboxRoot: string;
let projectsDir: string;
vi.mock("@/lib/content/paths", () => ({
  get DROPBOX_ROOT() { return dropboxRoot; },
  get PROJECTS_DIR() { return projectsDir; },
}));

import { PATCH, POST } from "./route";

const context = { params: Promise.resolve({ slug: "demo" }) };

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  const root = temporaryRoot();
  dropboxRoot = path.join(root, "Dropbox");
  projectsDir = path.join(root, "local-projects");
  fs.mkdirSync(path.join(projectsDir, "demo"), { recursive: true });
  fs.writeFileSync(path.join(projectsDir, "demo", "project.yaml"), "name: Demo\ndropbox_path: \"1.00 PROJECTS/Demo\"\n", "utf8");
  fs.writeFileSync(path.join(projectsDir, "demo", "details.yaml"), "name: Demo\n", "utf8");
  fs.mkdirSync(path.join(dropboxRoot, "1.00 PROJECTS", "Demo", "Mi", "project"), { recursive: true });
  mocks.project.meta = { dropbox_path: "1.00 PROJECTS/Demo", content_location: "local" };
});

describe("content-migration route", () => {
  it("previews without writing anything", async () => {
    const response = await POST(new Request("http://localhost/api/projects/demo/content-migration", { method: "POST" }), context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.preview.entries).toEqual([
      expect.objectContaining({ relativePath: "details.yaml", status: "will-copy" }),
    ]);
    expect(fs.existsSync(path.join(dropboxRoot, "1.00 PROJECTS", "Demo", "Mi", "project", "details.yaml"))).toBe(false);
  });

  it("refuses to preview or apply when the project has no dropbox_path", async () => {
    mocks.project.meta.dropbox_path = null;
    const response = await POST(new Request("http://localhost/api/projects/demo/content-migration", { method: "POST" }), context);
    expect(response.status).toBe(409);
  });

  it("rejects apply without explicit confirmation", async () => {
    const response = await PATCH(new Request("http://localhost/api/projects/demo/content-migration", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    }), context);
    expect(response.status).toBe(409);
  });

  it("applies a clean migration and marks the project migrated", async () => {
    const response = await PATCH(new Request("http://localhost/api/projects/demo/content-migration", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }),
    }), context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.migrationComplete).toBe(true);
    expect(data.results).toEqual([{ relativePath: "details.yaml", status: "copied" }]);

    const destFile = path.join(dropboxRoot, "1.00 PROJECTS", "Demo", "Mi", "project", "details.yaml");
    expect(fs.readFileSync(destFile, "utf8")).toBe("name: Demo\n");
    const projectYaml = fs.readFileSync(path.join(projectsDir, "demo", "project.yaml"), "utf8");
    expect(projectYaml).toContain("content_location: dropbox");
    expect(projectYaml).toContain("content_migrated_at:");
  });

  it("does not flip content_location when a needs-review file is left unresolved", async () => {
    const destFile = path.join(dropboxRoot, "1.00 PROJECTS", "Demo", "Mi", "project", "details.yaml");
    fs.writeFileSync(destFile, "name: Conflicting\n", "utf8");
    const response = await PATCH(new Request("http://localhost/api/projects/demo/content-migration", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }),
    }), context);
    const data = await response.json();
    expect(data.migrationComplete).toBe(false);
    expect(fs.readFileSync(destFile, "utf8")).toBe("name: Conflicting\n");
  });
});
