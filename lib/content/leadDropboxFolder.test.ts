import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyLeadDropboxFolder,
  LEAD_DROPBOX_SUBFOLDERS,
  previewLeadDropboxFolder,
} from "./leadDropboxFolder";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-lead-dropbox-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("lead Dropbox folder planning", () => {
  it("previews without writing, then creates the exact standard structure only after confirmation", () => {
    const root = temporaryRoot();
    const plan = previewLeadDropboxFolder(root, "1.01 LEADS/26_0811_Demo", "create");
    const target = path.join(root, "1.01 LEADS", "26_0811_Demo");

    expect(plan.folders).toEqual([...LEAD_DROPBOX_SUBFOLDERS]);
    expect(fs.existsSync(target)).toBe(false);
    expect(() => applyLeadDropboxFolder(root, plan, false)).toThrow(/confirmation/i);

    applyLeadDropboxFolder(root, plan, true);
    for (const folder of LEAD_DROPBOX_SUBFOLDERS) {
      expect(fs.statSync(path.join(target, folder)).isDirectory()).toBe(true);
    }
  });

  it("links an existing selected folder without changing its contents", () => {
    const root = temporaryRoot();
    const target = path.join(root, "1.01 LEADS", "Existing Lead");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "keep.txt"), "unchanged", "utf8");

    const plan = previewLeadDropboxFolder(root, "1.01 LEADS\\Existing Lead", "link-existing");
    expect(plan.relativePath).toBe("1.01 LEADS/Existing Lead");
    expect(plan.folders).toEqual([]);
    expect(fs.readdirSync(target)).toEqual(["keep.txt"]);
  });

  it("can fill missing subfolders beneath an already-confirmed empty lead folder", () => {
    const root = temporaryRoot();
    const target = path.join(root, "1.01 LEADS", "Existing Empty Lead");
    fs.mkdirSync(target, { recursive: true });
    const plan = previewLeadDropboxFolder(
      root,
      "1.01 LEADS/Existing Empty Lead",
      "create",
      { allowExistingRoot: true },
    );

    applyLeadDropboxFolder(root, plan, true);
    expect(fs.readdirSync(target).sort()).toEqual([...LEAD_DROPBOX_SUBFOLDERS].sort());
  });

  it("rejects traversal, a missing existing selection, and creating over an existing folder", () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, "1.01 LEADS", "Already Here"), { recursive: true });

    expect(() => previewLeadDropboxFolder(root, "../outside", "create")).toThrow(/unsafe|relative|escapes/i);
    expect(() => previewLeadDropboxFolder(root, "1.01 LEADS/Missing", "link-existing")).toThrow(/does not exist/i);
    expect(() => previewLeadDropboxFolder(root, "1.01 LEADS/Already Here", "create")).toThrow(/already exists/i);
  });
});
