import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentRootUnavailableError, resolveProjectContentRoot } from "./projectContentRoot";
import type { ProjectMeta } from "@/lib/schema";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-content-root-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function baseMeta(overrides: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    name: "Demo", address: "", client: "", status: "in-progress",
    building_type: null, occupancy_group: [], start_date: null, team: [],
    dropbox_path: null, content_location: "local", content_migrated_at: null,
    notion_page_id: null, client_id: null,
    ...overrides,
  };
}

describe("resolveProjectContentRoot", () => {
  it("resolves the local per-user path when content_location is local (today's default)", () => {
    const result = resolveProjectContentRoot(baseMeta(), "demo", null);
    expect(result.shared).toBe(false);
    expect(result.dir.endsWith(path.join("projects", "demo"))).toBe(true);
  });

  it("resolves to <DROPBOX_ROOT>/<dropbox_path>/Mi/project when migrated and reachable", () => {
    const dropboxRoot = temporaryRoot();
    const projectMiDir = path.join(dropboxRoot, "1.00 PROJECTS", "Demo", "Mi", "project");
    fs.mkdirSync(projectMiDir, { recursive: true });

    const meta = baseMeta({ content_location: "dropbox", dropbox_path: "1.00 PROJECTS/Demo" });
    const result = resolveProjectContentRoot(meta, "demo", dropboxRoot);
    expect(result.shared).toBe(true);
    expect(result.dir).toBe(projectMiDir);
  });

  it("throws ContentRootUnavailableError when migrated but DROPBOX_ROOT is unset", () => {
    const meta = baseMeta({ content_location: "dropbox", dropbox_path: "1.00 PROJECTS/Demo" });
    expect(() => resolveProjectContentRoot(meta, "demo", null)).toThrow(ContentRootUnavailableError);
  });

  it("throws ContentRootUnavailableError when migrated but the shared folder hasn't synced/isn't reachable", () => {
    const dropboxRoot = temporaryRoot();
    const meta = baseMeta({ content_location: "dropbox", dropbox_path: "1.00 PROJECTS/Demo" });
    expect(() => resolveProjectContentRoot(meta, "demo", dropboxRoot)).toThrow(ContentRootUnavailableError);
  });

  it("never falls back to the local root when migrated and unreachable -- fails closed", () => {
    const meta = baseMeta({ content_location: "dropbox", dropbox_path: "1.00 PROJECTS/Demo" });
    try {
      resolveProjectContentRoot(meta, "demo", null);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentRootUnavailableError);
    }
  });
});
