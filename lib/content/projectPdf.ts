import path from "node:path";
import { extractPdfDocument } from "@/electron/pdfExtraction";
import { resolveConfirmedProjectDir } from "./dropboxMirror";
import { resolveFileWithinDir } from "./fileServing";
import { DROPBOX_ROOT } from "./paths";
import { getProject } from "./projects";

function relativeSegments(value: string): string[] {
  if (!value.trim() || path.isAbsolute(value) || value.includes("\0")) {
    throw new Error("Choose a project-relative PDF path.");
  }
  return value.replaceAll("\\", "/").split("/").filter(Boolean);
}

export async function inspectProjectPdf(
  slug: string,
  relativePath: string,
  range: { firstPage?: number | null; lastPage?: number | null } = {},
) {
  const project = getProject(slug);
  if (!DROPBOX_ROOT || !project.meta.dropbox_path) {
    throw new Error("Confirm this project's Dropbox folder before inspecting its PDFs.");
  }
  if (path.extname(relativePath).toLowerCase() !== ".pdf") throw new Error("Choose a PDF file.");

  const projectDir = resolveConfirmedProjectDir(DROPBOX_ROOT, project.meta.dropbox_path);
  const resolved = resolveFileWithinDir(projectDir, relativeSegments(relativePath));
  if (!resolved.ok) throw new Error(resolved.message === "Invalid path" ? "The PDF path escapes this project." : "PDF not found.");
  return extractPdfDocument(resolved.absolutePath, range);
}
