import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(() => ({
    mirrored: true,
    destination: "C:\\Dropbox\\STUDIO\\1.00 PROJECTS\\Demo\\Mi",
    fileCount: 12,
  })),
  mirror: vi.fn(() => ({
    mirrored: true,
    destination: "C:\\Dropbox\\STUDIO\\1.00 PROJECTS\\Demo\\Mi",
    fileCount: 12,
  })),
}));

vi.mock("@/lib/content", () => ({
  getAllProjects: vi.fn(() => [
    { slug: "demo", meta: { dropbox_path: "1.00 PROJECTS/Demo" } },
    { slug: "unlinked", meta: { dropbox_path: null } },
  ]),
  getProjectSlugs: vi.fn(() => ["demo", "unlinked"]),
  mirrorProjectKnowledge: mocks.mirror,
  previewProjectKnowledgeMirror: mocks.preview,
}));

import {
  dropboxSyncCommand,
  parseDropboxSyncArgs,
} from "./dropboxSync";

describe("Dropbox sync CLI confirmation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("previews a project without writing by default", () => {
    dropboxSyncCommand(["demo"]);

    expect(mocks.preview).toHaveBeenCalledWith("demo");
    expect(mocks.mirror).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Preview only"));
  });

  it("requires an exact second confirmation before applying", () => {
    expect(() => parseDropboxSyncArgs(["demo", "--apply"]))
      .toThrow(/--confirm-project demo/);
    expect(() =>
      parseDropboxSyncArgs(["demo", "--apply", "--confirm-project", "other"]),
    ).toThrow(/--confirm-project demo/);

    dropboxSyncCommand(["demo", "--apply", "--confirm-project", "demo"]);
    expect(mocks.preview).toHaveBeenCalledWith("demo");
    expect(mocks.mirror).toHaveBeenCalledWith("demo");
  });

  it("allows portfolio-wide preview but refuses a bulk apply", () => {
    expect(parseDropboxSyncArgs(["--all"])).toMatchObject({
      all: true,
      apply: false,
    });
    expect(() => parseDropboxSyncArgs(["--all", "--apply"]))
      .toThrow(/one project at a time/);
  });

  it("rejects ambiguous or unknown arguments", () => {
    expect(() => parseDropboxSyncArgs([])).toThrow(/Usage/);
    expect(() => parseDropboxSyncArgs(["demo", "extra"])).toThrow(/Usage/);
    expect(() => parseDropboxSyncArgs(["demo", "--mystery"])).toThrow(/Unknown option/);
    expect(() => parseDropboxSyncArgs(["demo", "--confirm-project", "demo"]))
      .toThrow(/only valid together with --apply/);
  });
});
