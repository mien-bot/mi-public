import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-scaffold-project-"));
  roots.push(root);
  return root;
}

let projectsDir: string;
vi.mock("./paths", () => ({ get PROJECTS_DIR() { return projectsDir; } }));

import { scaffoldProject } from "./scaffoldProject";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("scaffoldProject", () => {
  it("leaves start_date null, like every other unknown field, instead of guessing today", () => {
    projectsDir = temporaryRoot();
    scaffoldProject("demo", "Demo Project");
    const projectYaml = fs.readFileSync(path.join(projectsDir, "demo", "project.yaml"), "utf8");
    expect(projectYaml).toContain("start_date: null");
    expect(projectYaml).toContain("building_type: null");
    expect(projectYaml).toContain("dropbox_path: null");
  });

  it("refuses to scaffold over an existing project directory", () => {
    projectsDir = temporaryRoot();
    scaffoldProject("demo", "Demo Project");
    expect(() => scaffoldProject("demo", "Demo Project")).toThrow(/already exists/);
  });

  it("fills in known values (client/address/status/notion/dropbox) when provided", () => {
    projectsDir = temporaryRoot();
    scaffoldProject("demo", "Demo Project", {
      client: "Acme",
      address: "123 Main St",
      status: "in-progress",
      notionPageId: "abc-123",
      dropboxPath: "1.00 PROJECTS/12_Demo Project",
    });
    const projectYaml = fs.readFileSync(path.join(projectsDir, "demo", "project.yaml"), "utf8");
    expect(projectYaml).toContain('client: "Acme"');
    expect(projectYaml).toContain('address: "123 Main St"');
    expect(projectYaml).toContain("status: in-progress");
    expect(projectYaml).toContain('notion_page_id: "abc-123"');
    expect(projectYaml).toContain('dropbox_path: "1.00 PROJECTS/12_Demo Project"');
  });
});
