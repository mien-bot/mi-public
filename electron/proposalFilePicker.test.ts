import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  MAX_PROPOSAL_FILE_BYTES,
  pickProposalFile,
  readProposalFile,
} = require("./proposalFilePicker.js");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempFile(name: string, content: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-proposal-picker-"));
  roots.push(root);
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

describe("proposal file picker", () => {
  it("reads exact UTF-8 JSON bytes and strips only a leading BOM", () => {
    const filePath = tempFile("mi-proposals.json", '\uFEFF{"version":1,"proposals":[]}\n');
    const result = readProposalFile(filePath);
    expect(result).toMatchObject({
      canceled: false,
      name: "mi-proposals.json",
      path: path.resolve(filePath),
      rawReply: '{"version":1,"proposals":[]}\n',
    });
    expect(result.bytes).toBe(Buffer.byteLength(result.rawReply, "utf8"));
    expect(new Date(result.mtime).toString()).not.toBe("Invalid Date");
  });

  it("rejects non-JSON and oversized files before reading", () => {
    expect(() => readProposalFile(tempFile("proposal.txt", "{}"))).toThrow(/\.json/);
    const oversized = tempFile("large.json", "x".repeat(MAX_PROPOSAL_FILE_BYTES + 1));
    expect(() => readProposalFile(oversized)).toThrow(/1 MB/);
  });

  it("uses an explicit native file choice and reports cancellation", async () => {
    const filePath = tempFile("chosen.json", '{"version":1,"proposals":[]}');
    const dialog = {
      showOpenDialog: vi.fn()
        .mockResolvedValueOnce({ canceled: true, filePaths: [] })
        .mockResolvedValueOnce({ canceled: false, filePaths: [filePath] }),
    };
    await expect(pickProposalFile({ dialog, parent: {}, defaultPath: "C:\\project\\Mi" }))
      .resolves.toEqual({ canceled: true });
    await expect(pickProposalFile({ dialog, parent: {}, defaultPath: "C:\\project\\Mi" }))
      .resolves.toMatchObject({ canceled: false, path: path.resolve(filePath) });
    expect(dialog.showOpenDialog).toHaveBeenCalledWith({}, expect.objectContaining({
      defaultPath: "C:\\project\\Mi",
      properties: ["openFile"],
    }));
  });
});
