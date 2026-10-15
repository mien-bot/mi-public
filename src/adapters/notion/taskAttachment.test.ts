import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachPrivatePdfToNotionTask } from "./taskAttachment";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NOTION_API_KEY;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function pdf(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-attachment-"));
  roots.push(root);
  const target = path.join(root, "agenda.pdf");
  fs.writeFileSync(target, "%PDF-1.4\n%%EOF\n");
  return target;
}

describe("private Notion PDF attachment", () => {
  it("creates, sends, attaches, and refetches a private upload", async () => {
    process.env.NOTION_API_KEY = "test-token";
    const uploadId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const blockId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: uploadId, status: "pending" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: uploadId, status: "uploaded" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: blockId, type: "pdf" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: blockId, type: "pdf", pdf: { type: "file" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(attachPrivatePdfToNotionTask(
      "44444444444444444444444444444444",
      pdf(),
    )).resolves.toMatchObject({
      status: "attached",
      blockId,
      privateUpload: true,
      publicLinkCreated: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ "Notion-Version": "2026-03-11" });
    expect(fetchMock.mock.calls[1][1].body).toBeInstanceOf(FormData);
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty("Content-Type");
  });

  it("returns unsupported without publishing when the file-upload endpoint is unavailable", async () => {
    process.env.NOTION_API_KEY = "test-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "object_not_found", message: "file upload endpoint not found" }),
      { status: 404, statusText: "Not Found" },
    )));
    await expect(attachPrivatePdfToNotionTask(
      "44444444444444444444444444444444",
      pdf(),
    )).resolves.toMatchObject({ status: "unsupported", publicLinkCreated: false });
  });

  it("preserves detailed Notion validation errors", async () => {
    process.env.NOTION_API_KEY = "test-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "validation_error", message: "Integration may not insert block children" }),
      { status: 400, statusText: "Bad Request" },
    )));
    await expect(attachPrivatePdfToNotionTask(
      "44444444444444444444444444444444",
      pdf(),
    )).rejects.toThrow("validation_error: Integration may not insert block children");
  });
});
