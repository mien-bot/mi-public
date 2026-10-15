import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDropboxReviewBrief, renderDropboxReviewBrief } from "./dropboxReview";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-qaqc-review-"));
  roots.push(root);
  const repoRoot = path.join(root, "repo");
  const dropboxRoot = path.join(root, "Dropbox");
  const projectDir = path.join(repoRoot, "projects", "demo");
  const sharedProject = path.join(dropboxRoot, "Projects", "Demo");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(sharedProject, "01_Drawings"), { recursive: true });
  fs.mkdirSync(path.join(sharedProject, "Mi"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "project.yaml"),
    'name: Demo\ndropbox_path: "Projects/Demo"\n',
  );
  fs.writeFileSync(path.join(sharedProject, "01_Drawings", "permit-set.pdf"), "synthetic");
  fs.writeFileSync(path.join(sharedProject, "Mi", "private-note.pdf"), "ignored");
  return { repoRoot, dropboxRoot };
}

describe("Dropbox QA/QC review brief", () => {
  it("inventories only the confirmed project and excludes its generated Mi harness", () => {
    const paths = fixture();
    const brief = buildDropboxReviewBrief({
      ...paths,
      projectSlug: "demo",
      now: new Date("2026-07-28T12:00:00.000Z"),
    });

    expect(brief.files.map((file) => file.relativePath)).toEqual(["01_Drawings/permit-set.pdf"]);
    expect(renderDropboxReviewBrief(brief)).toContain("does not claim to have reviewed drawing contents");
  });

  it("fails closed without a human-confirmed Dropbox link", () => {
    const paths = fixture();
    fs.writeFileSync(
      path.join(paths.repoRoot, "projects", "demo", "project.yaml"),
      "name: Demo\ndropbox_path: null\n",
    );

    expect(() => buildDropboxReviewBrief({ ...paths, projectSlug: "demo" }))
      .toThrow(/human-confirmed project dropbox_path/);
  });
});
