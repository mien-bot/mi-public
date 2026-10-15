import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { renameDurably, retryWhileLocked } from "@/lib/content/durableRename";
import { brandPdfWithMi } from "./pdfBranding";
import { standardFontOptions } from "./pdfStandardFonts";

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 500;

export interface PdfOutputRequest {
  source_path: string;
  output_path: string;
  overwrite: boolean;
  attach_to_task: boolean;
}

export interface PdfPreflight {
  sourcePath: string;
  outputPath: string;
  outputDirectory: string;
  targetExists: boolean;
  canCreate: boolean;
  attachRequested: boolean;
  publicLinkCreated: false;
}

export interface StagedPdf {
  stagedPath: string;
  sourceHash: string;
  pageCount: number;
  renderedPages: string[];
  renderManifestHash: string;
  /**
   * What Mi's own mark did to this file. `applied: false` carries the exact reason and must
   * be reported as-is: a caller that says "branded" over a skipped stamp is claiming
   * something about a document a person is about to send out.
   */
  branding: { applied: boolean; reason: string; pagesStamped: number };
}

function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function absolutePdf(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be an exact absolute path.`);
  const resolved = path.resolve(value);
  if (path.extname(resolved).toLowerCase() !== ".pdf") throw new Error(`${label} must end in .pdf.`);
  return resolved;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function preflightPdfOutput(request: PdfOutputRequest, workspaceRoot: string): PdfPreflight {
  const sourcePath = absolutePdf(request.source_path, "pdf.source_path");
  const outputPath = absolutePdf(request.output_path, "pdf.output_path");
  const scratchpad = path.join(path.resolve(workspaceRoot), "scratchpad");
  if (!isInside(scratchpad, sourcePath)) {
    throw new Error("pdf.source_path must stay inside this project's Mi/scratchpad workspace.");
  }
  const outputDirectory = path.dirname(outputPath);
  if (!fs.existsSync(outputDirectory) || !fs.statSync(outputDirectory).isDirectory()) {
    throw new Error("The exact PDF output directory does not exist.");
  }
  fs.accessSync(outputDirectory, fs.constants.W_OK);
  const targetExists = fs.existsSync(outputPath);
  if (targetExists && !request.overwrite) {
    throw new Error("The exact PDF output file already exists. Set overwrite=true and obtain a new explicit confirmation.");
  }
  return {
    sourcePath,
    outputPath,
    outputDirectory,
    targetExists,
    canCreate: true,
    attachRequested: request.attach_to_task,
    publicLinkCreated: false,
  };
}

export async function stageAndRenderPdf(
  preflight: PdfPreflight,
  stagingDirectory: string,
): Promise<StagedPdf> {
  if (!fs.existsSync(preflight.sourcePath) || !fs.statSync(preflight.sourcePath).isFile()) {
    throw new Error("Create the approved source PDF in Mi/scratchpad before staging it.");
  }
  const sourceBytes = fs.readFileSync(preflight.sourcePath);
  if (sourceBytes.length > MAX_PDF_BYTES) throw new Error("The PDF exceeds Mi's 20 MB verified-output limit.");

  /**
   * The Mi mark goes on here, before anything is hashed, rendered, or written.
   *
   * Stamping the staged copy — never the agent's source file in `scratchpad/` — makes the
   * branded bytes the single thing the rest of this flow talks about: the pages the human
   * inspects are the branded pages, the render-manifest hash covers them, and the file that
   * lands at the approved path is byte-for-byte what was reviewed. Doing it after the
   * review instead would publish a document nobody had actually looked at.
   */
  const branded = await brandPdfWithMi(sourceBytes);
  if ((!branded.applied && !branded.alreadyBranded) || branded.pagesSkipped) {
    throw new Error(`The PDF cannot be published with the Mi mark on every page. ${branded.reason}`);
  }
  const bytes = branded.bytes;
  fs.mkdirSync(stagingDirectory, { recursive: true });
  const stagedPath = path.join(stagingDirectory, "approved-output.pdf");
  fs.writeFileSync(stagedPath, bytes, { flag: "wx" });

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const fonts = standardFontOptions();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    // Real font data replaces the guesswork `useSystemFonts` falls back to. Without it
    // every non-embedded Helvetica/Times/Courier glyph renders as the wrong shape, and
    // this render is the only thing the person approving the document actually sees.
    useSystemFonts: fonts.standardFontDataUrl === undefined,
    ...fonts,
  });
  const document = await loadingTask.promise;
  try {
    if (document.numPages > MAX_PDF_PAGES) throw new Error(`The PDF exceeds Mi's ${MAX_PDF_PAGES}-page limit.`);
    const renderedPages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
      const imagePath = path.join(stagingDirectory, `page-${String(pageNumber).padStart(4, "0")}.png`);
      fs.writeFileSync(imagePath, canvas.toBuffer("image/png"), { flag: "wx" });
      renderedPages.push(imagePath);
      page.cleanup();
    }
    const manifest = JSON.stringify({ sourceHash: sha256(bytes), pageCount: document.numPages, renderedPages });
    return {
      stagedPath,
      sourceHash: sha256(bytes),
      pageCount: document.numPages,
      renderedPages,
      renderManifestHash: sha256(manifest),
      branding: {
        applied: branded.applied,
        reason: branded.reason,
        pagesStamped: branded.pagesStamped,
      },
    };
  } finally {
    await loadingTask.destroy();
  }
}

export function finalizeStagedPdf(
  staged: StagedPdf,
  preflight: PdfPreflight,
  overwrite: boolean,
): {
  absolutePath: string;
  pageCount: number;
  sha256: string;
  overwritten: boolean;
  branding: StagedPdf["branding"];
} {
  const targetNowExists = fs.existsSync(preflight.outputPath);
  if (targetNowExists !== preflight.targetExists) {
    throw new Error("The PDF output target's existence changed after approval. Preview and confirm again.");
  }
  if (targetNowExists && !overwrite) throw new Error("The approved operation does not permit overwriting this PDF.");
  const temporary = path.join(
    preflight.outputDirectory,
    `.${path.basename(preflight.outputPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  retryWhileLocked(() => fs.copyFileSync(staged.stagedPath, temporary, fs.constants.COPYFILE_EXCL));
  try {
    const copiedHash = sha256(fs.readFileSync(temporary));
    if (copiedHash !== staged.sourceHash) throw new Error("The temporary PDF failed its integrity check.");
    if (targetNowExists) {
      const backup = `${preflight.outputPath}.mi-backup-${Date.now()}`;
      renameDurably(preflight.outputPath, backup);
      try {
        renameDurably(temporary, preflight.outputPath);
      } catch (error) {
        renameDurably(backup, preflight.outputPath);
        throw error;
      }
    } else {
      renameDurably(temporary, preflight.outputPath);
    }
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
  if (sha256(fs.readFileSync(preflight.outputPath)) !== staged.sourceHash) {
    throw new Error("The finalized PDF failed its post-write integrity check.");
  }
  return {
    absolutePath: preflight.outputPath,
    pageCount: staged.pageCount,
    sha256: staged.sourceHash,
    overwritten: targetNowExists,
    // Carried through to the final report: whether the published file actually wears the
    // Mi mark is part of what happened to it, not just a detail of the staging step.
    branding: staged.branding,
  };
}
