import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { inspectSharedData, totalRecords, findSharedDataCandidates } = require("./sharedDataInspection");

/**
 * The second-computer case this exists for: the partner picked a Dropbox root, projects still
 * read zero, and nothing on screen says why. Inspection has to distinguish "the shared folder
 * is empty or unsynced" from "the shared folder is full but this computer isn't using it yet".
 */

const roots: string[] = [];

function machine({ seedShared, sharedFolderName = "7.00 Mi Data" }: {
  seedShared: boolean;
  sharedFolderName?: string;
}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mi-shared-inspect-"));
  roots.push(base);
  const dropboxRoot = path.join(base, "Dropbox", "STUDIO");
  const localDataRoot = path.join(base, "local-app-data");
  const shared = path.join(dropboxRoot, sharedFolderName);

  // A fresh install's own data root: the folders exist, every one of them empty.
  for (const kind of ["projects", "leads", "clients", "permit-qaqc"]) {
    fs.mkdirSync(path.join(localDataRoot, kind), { recursive: true });
  }
  fs.mkdirSync(shared, { recursive: true });

  if (seedShared) {
    for (const slug of ["example-project-18", "26-0804-abc-clinic"]) {
      fs.mkdirSync(path.join(shared, "projects", slug), { recursive: true });
      fs.writeFileSync(path.join(shared, "projects", slug, "project.yaml"), "name: Seeded\n");
    }
    fs.mkdirSync(path.join(shared, "leads", "alpha"), { recursive: true });
    fs.writeFileSync(path.join(shared, "leads", "alpha", "lead.yaml"), "name: Alpha\n");
    fs.mkdirSync(path.join(shared, "clients"), { recursive: true });
    fs.writeFileSync(path.join(shared, "clients", "acme.yaml"), "name: Acme\n");
    fs.mkdirSync(path.join(shared, "permit-qaqc", "beta"), { recursive: true });
    fs.writeFileSync(path.join(shared, "permit-qaqc", "beta", "qaqc.yaml"), "name: Beta\n");
  }

  return { dropboxRoot, localDataRoot, sharedFolderName };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("inspecting a candidate shared Mi data folder", () => {
  it("reports the firm's records while this computer still reads its own empty local root", () => {
    const { dropboxRoot, localDataRoot, sharedFolderName } = machine({ seedShared: true });
    const report = inspectSharedData({
      dropboxRoot,
      sharedRelativePath: sharedFolderName,
      sharedDataRootEnabled: false,
      localDataRoot,
    });

    expect(report.reachable).toBe(true);
    expect(report.error).toBeNull();
    expect(report.shared).toEqual({ projects: 2, leads: 1, clients: 1, permitQaqc: 1 });
    // The whole point: full folder, zero on screen, because it isn't the data source yet.
    expect(report.usingAsDataSource).toBe(false);
    expect(report.local).toEqual({ projects: 0, leads: 0, clients: 0, permitQaqc: 0 });
    expect(report.sharedTotal).toBe(5);
    expect(report.localTotal).toBe(0);
  });

  it("separates a reachable but empty shared folder from one that is simply unused", () => {
    const { dropboxRoot, localDataRoot, sharedFolderName } = machine({ seedShared: false });
    const report = inspectSharedData({
      dropboxRoot,
      sharedRelativePath: sharedFolderName,
      sharedDataRootEnabled: false,
      localDataRoot,
    });

    expect(report.reachable).toBe(true);
    expect(report.sharedTotal).toBe(0);
    // Absent folders read as null, not 0 -- "never synced here" is not "synced and empty".
    expect(report.shared).toEqual({ projects: null, leads: null, clients: null, permitQaqc: null });
  });

  it("counts a record only once its marker file has finished syncing", () => {
    const { dropboxRoot, localDataRoot, sharedFolderName } = machine({ seedShared: true });
    fs.mkdirSync(path.join(dropboxRoot, sharedFolderName, "projects", "26-still-downloading"));

    const report = inspectSharedData({
      dropboxRoot,
      sharedRelativePath: sharedFolderName,
      sharedDataRootEnabled: false,
      localDataRoot,
    });

    expect(report.shared.projects).toBe(2);
  });

  it("reports an unreachable folder as an inline error instead of throwing", () => {
    const { dropboxRoot, localDataRoot } = machine({ seedShared: false });
    const report = inspectSharedData({
      dropboxRoot,
      sharedRelativePath: "9.00 Not Synced Yet",
      sharedDataRootEnabled: true,
      localDataRoot,
    });

    expect(report.reachable).toBe(false);
    expect(report.error).toMatch(/unavailable/i);
    expect(report.shared).toBeNull();
  });

  it("refuses a shared path that escapes the Dropbox root", () => {
    const { dropboxRoot, localDataRoot } = machine({ seedShared: false });
    const report = inspectSharedData({
      dropboxRoot,
      sharedRelativePath: "../..",
      sharedDataRootEnabled: false,
      localDataRoot,
    });

    expect(report.reachable).toBe(false);
    expect(report.error).toMatch(/inside the configured Dropbox root/i);
  });

  it("asks for the missing prerequisite instead of guessing one", () => {
    const { dropboxRoot, localDataRoot, sharedFolderName } = machine({ seedShared: true });

    expect(inspectSharedData({
      dropboxRoot: null,
      sharedRelativePath: sharedFolderName,
      sharedDataRootEnabled: false,
      localDataRoot,
    }).error).toMatch(/Dropbox root/i);

    expect(inspectSharedData({
      dropboxRoot,
      sharedRelativePath: "  ",
      sharedDataRootEnabled: false,
      localDataRoot,
    }).error).toMatch(/shared Mi data folder/i);
  });

  it("treats an absent folder as zero when totalling", () => {
    expect(totalRecords(null)).toBe(0);
    expect(totalRecords({ projects: 3, leads: null, clients: 0, permitQaqc: 2 })).toBe(5);
  });
});

describe("finding the firm's Mi data folder inside a Dropbox root", () => {
  it("matches on contents, not on the folder's name", () => {
    const { dropboxRoot } = machine({ seedShared: true, sharedFolderName: "Mi Records (Renamed)" });
    const [candidate, ...rest] = findSharedDataCandidates(dropboxRoot);

    expect(candidate.relativePath).toBe("Mi Records (Renamed)");
    expect(candidate.total).toBe(5);
    expect(candidate.counts.projects).toBe(2);
    expect(rest).toHaveLength(0);
  });

  it("finds a folder nested one level below the Dropbox root", () => {
    const { dropboxRoot } = machine({ seedShared: true, sharedFolderName: "5.00 SOFTWARE DEV/Mi Data" });
    expect(findSharedDataCandidates(dropboxRoot)[0].relativePath).toBe("5.00 SOFTWARE DEV/Mi Data");
  });

  it("ignores ordinary project folders that hold no Mi records", () => {
    const { dropboxRoot } = machine({ seedShared: true });
    fs.mkdirSync(path.join(dropboxRoot, "1.00 PROJECTS", "06_Gamma", "Drawings"), { recursive: true });
    fs.writeFileSync(path.join(dropboxRoot, "1.00 PROJECTS", "06_Gamma", "Drawings", "a.pdf"), "x");

    const candidates = findSharedDataCandidates(dropboxRoot);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].relativePath).toBe("7.00 Mi Data");
  });

  it("ranks the fullest candidate first when a stale copy also exists", () => {
    const { dropboxRoot } = machine({ seedShared: true });
    const stale = path.join(dropboxRoot, "Mi Data (old)");
    fs.mkdirSync(path.join(stale, "projects", "example-project-18"), { recursive: true });
    fs.writeFileSync(path.join(stale, "projects", "example-project-18", "project.yaml"), "name: Old\n");

    const candidates = findSharedDataCandidates(dropboxRoot) as Array<{ relativePath: string }>;
    expect(candidates.map((entry) => entry.relativePath)).toEqual(["7.00 Mi Data", "Mi Data (old)"]);
  });

  it("returns nothing rather than guessing when no folder holds Mi records", () => {
    const { dropboxRoot } = machine({ seedShared: false });
    expect(findSharedDataCandidates(dropboxRoot)).toEqual([]);
    expect(findSharedDataCandidates(null)).toEqual([]);
  });
});
