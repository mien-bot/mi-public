import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-next-numbering-"));
  roots.push(root);
  return root;
}

let dropboxRoot: string | null = null;
vi.mock("@/lib/content/paths", () => ({ get DROPBOX_ROOT() { return dropboxRoot; } }));

import { GET } from "./route";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  dropboxRoot = null;
});

describe("GET /api/projects/next-numbering", () => {
  it("suggests today's YY_MMDD_ prefix for the Notion name regardless of Dropbox availability", async () => {
    const response = await GET();
    const data = await response.json();
    const now = new Date();
    const expected = `${String(now.getFullYear() % 100).padStart(2, "0")}_${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_`;
    expect(data.notionNamePrefix).toBe(expected);
  });

  it("returns a null Dropbox suggestion when DROPBOX_ROOT is unset", async () => {
    dropboxRoot = null;
    const response = await GET();
    const data = await response.json();
    expect(data.dropboxFolderPrefix).toBeNull();
  });

  it("returns a null Dropbox suggestion when 1.00 PROJECTS doesn't exist yet", async () => {
    dropboxRoot = temporaryRoot();
    const response = await GET();
    const data = await response.json();
    expect(data.dropboxFolderPrefix).toBeNull();
  });

  it("suggests the next available folder number from real Dropbox folders", async () => {
    dropboxRoot = temporaryRoot();
    const projectsRoot = path.join(dropboxRoot, "1.00 PROJECTS");
    fs.mkdirSync(path.join(projectsRoot, "07_SampleStudio"), { recursive: true });
    fs.mkdirSync(path.join(projectsRoot, "11_1002 S Example Blvd Ave"), { recursive: true });
    fs.mkdirSync(path.join(projectsRoot, "Project Template"), { recursive: true });

    const response = await GET();
    const data = await response.json();
    expect(data.dropboxFolderPrefix).toBe("12_");
  });

  it("ignores year folders sitting beside the numbered projects", async () => {
    dropboxRoot = temporaryRoot();
    const projectsRoot = path.join(dropboxRoot, "1.00 PROJECTS");
    fs.mkdirSync(path.join(projectsRoot, "20_HeyTea-Schaumburg"), { recursive: true });
    fs.mkdirSync(path.join(projectsRoot, "21_ABC Clinic"), { recursive: true });
    fs.mkdirSync(path.join(projectsRoot, "2024"), { recursive: true });
    fs.mkdirSync(path.join(projectsRoot, "2025 Archive"), { recursive: true });

    const response = await GET();
    const data = await response.json();
    expect(data.dropboxFolderPrefix).toBe("22_");
  });

  it("keeps counting past the two-digit folders it pads to", async () => {
    dropboxRoot = temporaryRoot();
    const projectsRoot = path.join(dropboxRoot, "1.00 PROJECTS");
    fs.mkdirSync(path.join(projectsRoot, "99_Ninety Nine"), { recursive: true });
    fs.mkdirSync(path.join(projectsRoot, "100_One Hundred"), { recursive: true });

    const response = await GET();
    const data = await response.json();
    expect(data.dropboxFolderPrefix).toBe("101_");
  });
});
