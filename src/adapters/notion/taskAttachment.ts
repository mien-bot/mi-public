import fs from "node:fs";
import path from "node:path";
import { notionFetchWithVersion } from "./client";
import { normalizeNotionId } from "./ids";

const FILE_UPLOAD_VERSION = "2026-03-11";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

interface FileUpload {
  id: string;
  status?: string;
  filename?: string;
}

interface BlockResponse {
  id: string;
  type: string;
  pdf?: { type?: string; file?: { url?: string }; file_upload?: { id?: string } };
}

export interface NotionAttachmentResult {
  status: "attached" | "unsupported";
  fileName: string;
  blockId?: string;
  privateUpload: true;
  publicLinkCreated: false;
  detail?: string;
}

function unsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Notion API 404|file[_ -]?upload.{0,80}(unsupported|unknown|not supported)|unsupported.{0,80}file[_ -]?upload/i.test(message);
}

export async function attachPrivatePdfToNotionTask(
  taskPageId: string,
  absolutePdfPath: string,
): Promise<NotionAttachmentResult> {
  const stat = fs.statSync(absolutePdfPath);
  if (!stat.isFile()) throw new Error("The approved PDF attachment is not a file.");
  if (stat.size > MAX_UPLOAD_BYTES) throw new Error("The approved PDF exceeds Notion's 20 MB direct-upload limit.");
  const fileName = path.basename(absolutePdfPath);
  try {
    const created = await notionFetchWithVersion<FileUpload>("/file_uploads", {
      method: "POST",
      body: JSON.stringify({ mode: "single_part", filename: fileName, content_type: "application/pdf" }),
    }, FILE_UPLOAD_VERSION);
    const form = new FormData();
    form.set("file", new Blob([fs.readFileSync(absolutePdfPath)], { type: "application/pdf" }), fileName);
    const uploaded = await notionFetchWithVersion<FileUpload>(`/file_uploads/${created.id}/send`, {
      method: "POST",
      body: form,
    }, FILE_UPLOAD_VERSION);
    if (uploaded.status && uploaded.status !== "uploaded") {
      throw new Error(`Notion file upload did not complete (status: ${uploaded.status}).`);
    }
    const appended = await notionFetchWithVersion<{ results?: BlockResponse[] }>(
      `/blocks/${normalizeNotionId(taskPageId, "task_page_id")}/children`,
      {
        method: "PATCH",
        body: JSON.stringify({
          children: [{
            object: "block",
            type: "pdf",
            pdf: { type: "file_upload", file_upload: { id: created.id } },
          }],
        }),
      },
      FILE_UPLOAD_VERSION,
    );
    const block = appended.results?.find((item) => item.type === "pdf");
    if (!block?.id) throw new Error("Notion accepted the upload but did not return the attached PDF block.");
    const verified = await notionFetchWithVersion<BlockResponse>(
      `/blocks/${normalizeNotionId(block.id, "attachment block ID")}`,
      undefined,
      FILE_UPLOAD_VERSION,
    );
    if (verified.type !== "pdf") throw new Error("Notion attachment verification returned a different block type.");
    return {
      status: "attached",
      fileName,
      blockId: normalizeNotionId(verified.id, "attachment block ID"),
      privateUpload: true,
      publicLinkCreated: false,
    };
  } catch (error) {
    if (unsupported(error)) {
      return {
        status: "unsupported",
        fileName,
        privateUpload: true,
        publicLinkCreated: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}
