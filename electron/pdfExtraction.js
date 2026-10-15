const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const DOMMatrixModule = require("@thednp/dommatrix");

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrixModule.default || DOMMatrixModule;
// Text/link inspection never draws paths. PDF.js still checks for this browser global while
// loading, so a deliberately non-rendering placeholder keeps the local server independent of a
// native canvas binary. Any future visual renderer must replace this with a real Path2D.
if (!globalThis.Path2D) globalThis.Path2D = class NonRenderingPath2D {};

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 500;
const MAX_EXTRACTED_CHARACTERS = 1_000_000;

function compactText(items) {
  let text = "";
  for (const item of items) {
    if (!item || typeof item.str !== "string") continue;
    const value = item.str.replace(/\u0000/g, "");
    if (value) {
      if (text && !/[\s-]$/.test(text) && !/^[,.;:!?)]/.test(value)) text += " ";
      text += value;
    }
    if (item.hasEOL) text += "\n";
  }
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeMetadata(info) {
  const fields = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"];
  return Object.fromEntries(fields.flatMap((field) => {
    const value = info && typeof info[field] === "string" ? info[field].trim() : "";
    return value ? [[field, value]] : [];
  }));
}

function linkDetails(annotation) {
  if (!annotation || annotation.subtype !== "Link") return null;
  const url = typeof annotation.url === "string"
    ? annotation.url
    : typeof annotation.unsafeUrl === "string"
      ? annotation.unsafeUrl
      : null;
  let destination = null;
  if (typeof annotation.dest === "string") destination = annotation.dest;
  else if (Array.isArray(annotation.dest)) destination = JSON.stringify(annotation.dest).slice(0, 500);
  return url || destination ? { url, destination } : { url: null, destination: null };
}

/**
 * Locates pdf.worker.mjs so PDF.js can load its fake worker.
 *
 * PDF.js decides it is running under Node with
 * `!(process.versions.electron && process.type && process.type !== "browser")` (pdf.mjs). In a
 * packaged build the local server is an Electron utilityProcess, so `process.type` is "utility",
 * that check is false, PDF.js believes it is in a browser, and it demands an explicit
 * GlobalWorkerOptions.workerSrc. Development never hits this -- there the server is an ordinary
 * spawned npm process -- so a missing workerSrc only ever surfaces in an installer.
 *
 * Electron passes MI_PDF_WORKER_SRC for the packaged runtime, where the worker sits beside the
 * traced pdfjs-dist copy. Everywhere else, ordinary resolution finds it.
 */
function resolveWorkerSource() {
  const configured = process.env.MI_PDF_WORKER_SRC;
  if (configured && fs.existsSync(configured)) return pathToFileURL(configured).href;
  try {
    return pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
  } catch {
    return null;
  }
}

/**
 * Extracts a PDF already held in memory. `source` describes where the bytes came from -- a
 * project file (name/bytes/modified_at) or a fetched URL -- so the caller's provenance survives
 * into the returned record. extractPdfDocument below is the on-disk entry point.
 */
/**
 * Resolves the caller's requested slice against the document's real length.
 *
 * This bounds the *work and the output*, not the load: MAX_PDF_BYTES is checked before pdfjs
 * ever sees the bytes, so a range cannot rescue an oversized file. What it does fix is the
 * silent end of a long set -- MAX_EXTRACTED_CHARACTERS is spent front-to-back, so on a 400-page
 * set the later pages come back empty with one "capped" warning and nothing else. Asking for
 * pages 300-350 spends the whole budget there instead.
 */
function resolvePageRange(numPages, { firstPage, lastPage } = {}) {
  const first = firstPage === undefined || firstPage === null ? 1 : Number(firstPage);
  const last = lastPage === undefined || lastPage === null ? numPages : Number(lastPage);
  if (!Number.isInteger(first) || !Number.isInteger(last)) {
    throw new Error("Page range values must be whole numbers.");
  }
  if (first < 1) throw new Error("The first page of a range is 1.");
  // Past-the-end is checked before the inverted-range test on purpose: an open-ended request
  // defaults `last` to numPages, so `-FirstPage 9` on a 4-page file would otherwise be reported
  // as an inverted range and send the caller looking for a mistake it did not make.
  if (first > numPages) {
    throw new Error(`The PDF has ${numPages} page(s); page ${first} is past the end.`);
  }
  if (last < first) throw new Error("A page range must end on or after its first page.");
  return { first, last: Math.min(last, numPages) };
}

async function extractPdfBytes(data, source, range = {}) {
  if (data.length > MAX_PDF_BYTES) throw new Error("The PDF exceeds Mi's 20 MB inspection limit.");

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const workerSource = resolveWorkerSource();
    if (workerSource) pdfjs.GlobalWorkerOptions.workerSrc = workerSource;
  }
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true,
  });

  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(`The PDF has ${document.numPages} pages; Mi's inspection limit is ${MAX_PDF_PAGES}.`);
    }

    const { first, last } = resolvePageRange(document.numPages, range);
    const metadata = await document.getMetadata().catch(() => ({ info: {} }));
    const pages = [];
    let extractedCharacters = 0;
    let pagesWithText = 0;
    let linkAnnotations = 0;
    let truncated = false;

    for (let pageNumber = first; pageNumber <= last; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const [textContent, annotations] = await Promise.all([
        page.getTextContent(),
        page.getAnnotations(),
      ]);
      const fullText = compactText(textContent.items);
      const remaining = Math.max(0, MAX_EXTRACTED_CHARACTERS - extractedCharacters);
      const text = fullText.slice(0, remaining);
      if (fullText.length > remaining) truncated = true;
      extractedCharacters += text.length;
      if (fullText.length > 0) pagesWithText += 1;

      const links = annotations.map(linkDetails).filter(Boolean);
      linkAnnotations += links.length;
      pages.push({
        page: pageNumber,
        text,
        text_characters: fullText.length,
        text_truncated: text.length < fullText.length,
        link_count: links.length,
        links,
      });
      page.cleanup();
    }

    const examinedPages = last - first + 1;
    const pagesWithoutText = examinedPages - pagesWithText;
    const warnings = [
      "Mi extracted the PDF text layer and link annotations locally. It did not visually render or inspect page layout, graphics, signatures, stamps, or image quality.",
    ];
    if (pagesWithoutText > 0) {
      warnings.push(`${pagesWithoutText} page(s) have no readable text layer and may require OCR or visual review.`);
    }
    // Said plainly, because every count below describes the slice and not the document: an
    // agent that misses this will report "3 pages, no mention of egress" about a 220-page set.
    if (examinedPages < document.numPages) {
      warnings.push(
        `Only pages ${first}-${last} of ${document.numPages} were examined. Every count here describes that range, not the whole document.`,
      );
    }
    if (truncated) warnings.push(`Extracted text was capped at ${MAX_EXTRACTED_CHARACTERS.toLocaleString()} characters.`);

    return {
      format_version: 1,
      source,
      summary: {
        page_count: document.numPages,
        examined_first_page: first,
        examined_last_page: last,
        examined_page_count: examinedPages,
        pages_with_text: pagesWithText,
        pages_without_text: pagesWithoutText,
        link_annotations: linkAnnotations,
        extracted_characters: extractedCharacters,
        text_truncated: truncated,
        visual_review: "not_performed",
      },
      metadata: safeMetadata(metadata.info),
      warnings,
      pages,
    };
  } finally {
    await loadingTask.destroy();
  }
}

async function extractPdfDocument(filePath, range = {}) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || path.extname(filePath).toLowerCase() !== ".pdf") {
    throw new Error("Choose a PDF file.");
  }
  if (stat.size > MAX_PDF_BYTES) throw new Error("The PDF exceeds Mi's 20 MB inspection limit.");
  return extractPdfBytes(new Uint8Array(fs.readFileSync(filePath)), {
    name: path.basename(filePath),
    bytes: stat.size,
    modified_at: stat.mtime.toISOString(),
  }, range);
}

module.exports = {
  MAX_EXTRACTED_CHARACTERS,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  compactText,
  extractPdfBytes,
  extractPdfDocument,
  resolveWorkerSource,
};
