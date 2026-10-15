import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extract: vi.fn(),
  resolveConfirmed: vi.fn(),
  resolveFile: vi.fn(),
  project: { meta: { dropbox_path: "Projects/Demo" } },
}));

vi.mock("@/electron/pdfExtraction", () => ({ extractPdfDocument: mocks.extract }));
vi.mock("./dropboxMirror", () => ({ resolveConfirmedProjectDir: mocks.resolveConfirmed }));
vi.mock("./fileServing", () => ({ resolveFileWithinDir: mocks.resolveFile }));
vi.mock("./paths", () => ({ DROPBOX_ROOT: "C:\\Dropbox" }));
vi.mock("./projects", () => ({ getProject: () => mocks.project }));

import { inspectProjectPdf } from "./projectPdf";

describe("project PDF inspection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConfirmed.mockReturnValue("C:\\Dropbox\\Projects\\Demo");
    mocks.resolveFile.mockReturnValue({
      ok: true,
      absolutePath: "C:\\Dropbox\\Projects\\Demo\\Admin\\evidence.pdf",
      contentType: "application/pdf",
    });
    mocks.extract.mockResolvedValue({ summary: { page_count: 1 } });
  });

  it("resolves only a confirmed project-relative PDF and returns local extraction", async () => {
    await expect(inspectProjectPdf("demo", "Admin\\evidence.pdf"))
      .resolves.toEqual({ summary: { page_count: 1 } });
    expect(mocks.resolveConfirmed).toHaveBeenCalledWith("C:\\Dropbox", "Projects/Demo");
    expect(mocks.resolveFile).toHaveBeenCalledWith(
      "C:\\Dropbox\\Projects\\Demo",
      ["Admin", "evidence.pdf"],
    );
  });

  it("rejects traversal, absolute paths, missing files, and non-PDF inputs", async () => {
    await expect(inspectProjectPdf("demo", "C:\\outside.pdf")).rejects.toThrow(/project-relative/i);
    await expect(inspectProjectPdf("demo", "notes.txt")).rejects.toThrow(/PDF file/i);
    mocks.resolveFile.mockReturnValue({ ok: false, status: 400, message: "Invalid path" });
    await expect(inspectProjectPdf("demo", "..\\outside.pdf")).rejects.toThrow(/escapes this project/i);
    mocks.resolveFile.mockReturnValue({ ok: false, status: 404, message: "Not found" });
    await expect(inspectProjectPdf("demo", "missing.pdf")).rejects.toThrow(/not found/i);
  });
});
