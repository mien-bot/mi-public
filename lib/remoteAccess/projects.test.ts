import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
let root: string, local: string, shared: string;
vi.mock("@/lib/content/projects", () => ({
  getProjectSlugs: () => ["fixture", "other"],
  getProject: () => ({ meta: { name: "Shared fixture", status: "in-progress", dropbox_path: "confirmed", content_location: "local" } }),
  contentDir: () => local,
  getSchedule: () => ({ milestones: [] }),
}));
vi.mock("@/lib/content/projectWorkspace", () => ({ getProjectDetails: () => ({ scope: "Saved scope" }) }));
vi.mock("@/lib/content/paths", () => ({ get DROPBOX_ROOT() { return root; } }));
import { remotePdf, remoteProject, remoteProjects } from "./projects";
const reader = { email: "partner@example.com" };
beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mi-remote-")));
  local = path.join(root, "local"); shared = path.join(root, "confirmed");
  fs.mkdirSync(local); fs.mkdirSync(path.join(shared, "Mi", "handoffs"), { recursive: true });
  vi.stubEnv("MI_REMOTE_PROJECT_GRANTS", JSON.stringify({ [reader.email]: ["fixture"] }));
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
describe("remote project data", () => {
  it("lists granted projects and returns only shared PDFs and bounded handoff fields", async () => {
    fs.writeFileSync(path.join(shared, "partner.pdf"), "%PDF-1.7 fixture");
    fs.writeFileSync(path.join(local, "private.pdf"), "%PDF-1.7 private");
    fs.writeFileSync(path.join(shared, "Mi", "handoffs", "shared.json"), JSON.stringify({
      version: 1, id: randomUUID(), title: "Reviewed handoff", summary: "Two options", createdAt: new Date().toISOString(),
      files: [{ source: "local", path: "private.pdf", revision: "private" }],
    }));
    expect(remoteProjects(reader).map(item => item.slug)).toEqual(["fixture"]);
    const result = await remoteProject(reader, "fixture");
    expect(result.files.map(file => file.name)).toEqual(["partner.pdf"]);
    expect(result.handoffs[0].summary).toBe("Two options");
    expect(JSON.stringify(result)).not.toContain("private.pdf");
    expect(JSON.stringify(result)).not.toContain(root.replaceAll("\\", "\\\\"));
    expect(result.files[0].href).toContain("/api/mobile/projects/fixture/pdf");
  });
  it("denies cross-project reads, private/traversal/junction paths, fake and oversized PDFs", async () => {
    fs.writeFileSync(path.join(shared, "valid.pdf"), "%PDF-1.7 fixture");
    expect((await remotePdf(reader, "fixture", "valid.pdf")).toString()).toContain("%PDF-");
    await expect(remoteProject(reader, "other")).rejects.toMatchObject({ status: 404 });
    await expect(remotePdf(reader, "other", "valid.pdf")).rejects.toMatchObject({ status: 404 });
    fs.writeFileSync(path.join(shared, "fake.pdf"), "not pdf");
    const fd = fs.openSync(path.join(shared, "large.pdf"), "wx"); fs.ftruncateSync(fd, 21 * 1024 * 1024); fs.closeSync(fd);
    fs.symlinkSync(local, path.join(shared, "linked"), "junction");
    for (const relative of ["../local/private.pdf", "linked/private.pdf", ".private.pdf", "secrets/file.pdf", "fake.pdf", "large.pdf"]) {
      await expect(remotePdf(reader, "fixture", relative)).rejects.toMatchObject({ status: 404 });
    }
    vi.stubEnv("MI_REMOTE_PROJECT_GRANTS", "{}");
    await expect(remotePdf(reader, "fixture", "valid.pdf")).rejects.toMatchObject({ status: 404 });
  });
});
