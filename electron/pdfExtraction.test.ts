import { afterEach, describe, expect, it } from "vitest";

const { compactText, extractPdfBytes, resolveWorkerSource } = require("./pdfExtraction");

/** A PDF with `pageCount` pages, each carrying its own page number as text. */
function multiPagePdf(pageCount: number): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 = catalog, 2 = pages tree, 3 = font; each page then takes two objects (page + contents).
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("PAGES_PLACEHOLDER");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let page = 1; page <= pageCount; page += 1) {
    const contentId = 4 + (page - 1) * 2;
    const pageId = contentId + 1;
    const stream = `BT /F1 12 Tf 72 720 Td (Sheet ${page} content) Tj ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;

  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "ascii"));
}

const source = { name: "set.pdf", bytes: 1, modified_at: "2026-08-08T00:00:00.000Z" };

describe("page-range inspection", () => {
  it("reads the whole document when no range is given", async () => {
    const result = await extractPdfBytes(multiPagePdf(5), source);

    expect(result.summary.page_count).toBe(5);
    expect(result.summary.examined_page_count).toBe(5);
    expect(result.pages).toHaveLength(5);
  });

  it("reads only the requested slice and numbers those pages by their real position", async () => {
    const result = await extractPdfBytes(multiPagePdf(8), source, { firstPage: 3, lastPage: 5 });

    expect(result.pages.map((page: { page: number }) => page.page)).toEqual([3, 4, 5]);
    expect(result.pages[0].text).toContain("Sheet 3");
    expect(result.summary.page_count).toBe(8);
    expect(result.summary.examined_first_page).toBe(3);
    expect(result.summary.examined_last_page).toBe(5);
  });

  it("warns that the counts describe the slice, not the document", async () => {
    const result = await extractPdfBytes(multiPagePdf(8), source, { firstPage: 3, lastPage: 5 });

    expect(result.warnings.join(" ")).toContain("Only pages 3-5 of 8 were examined");
  });

  it("keeps the text-only caveat when a range is used", async () => {
    const result = await extractPdfBytes(multiPagePdf(4), source, { firstPage: 2 });

    expect(result.warnings[0]).toContain("did not visually render");
  });

  it("clamps a range that runs past the last page instead of failing", async () => {
    const result = await extractPdfBytes(multiPagePdf(4), source, { firstPage: 3, lastPage: 99 });

    expect(result.summary.examined_last_page).toBe(4);
    expect(result.pages).toHaveLength(2);
  });

  it("rejects a range that starts past the end, naming the real page count", async () => {
    await expect(extractPdfBytes(multiPagePdf(4), source, { firstPage: 9 }))
      .rejects.toThrow(/has 4 page\(s\); page 9 is past the end/);
  });

  it("rejects an inverted range", async () => {
    await expect(extractPdfBytes(multiPagePdf(4), source, { firstPage: 3, lastPage: 2 }))
      .rejects.toThrow(/end on or after its first page/);
  });
});

const originalWorkerSource = process.env.MI_PDF_WORKER_SRC;

afterEach(() => {
  if (originalWorkerSource === undefined) delete process.env.MI_PDF_WORKER_SRC;
  else process.env.MI_PDF_WORKER_SRC = originalWorkerSource;
});

/**
 * A packaged build runs the local server as an Electron utilityProcess, where PDF.js cannot
 * detect Node and refuses to work without an explicit worker location. Development never
 * reproduces that, so this is the only guard against shipping an installer whose PDF reading
 * silently fails.
 */
describe("PDF worker resolution", () => {
  it("finds the worker through ordinary resolution when no override is set", () => {
    delete process.env.MI_PDF_WORKER_SRC;
    const resolved = resolveWorkerSource();
    expect(resolved).toMatch(/^file:\/\/\//);
    expect(resolved).toMatch(/pdf\.worker\.mjs$/);
  });

  it("prefers the packaged override and returns it as a file URL PDF.js can import", () => {
    // Any real file proves the override path is honored without depending on a build artifact.
    process.env.MI_PDF_WORKER_SRC = __filename;
    const resolved = resolveWorkerSource();
    expect(resolved).toMatch(/^file:\/\/\//);
    expect(decodeURIComponent(resolved)).toContain("pdfExtraction.test.ts");
  });

  it("ignores an override pointing at a file that is not there", () => {
    process.env.MI_PDF_WORKER_SRC = "C:\\nowhere\\pdf.worker.mjs";
    expect(resolveWorkerSource()).toMatch(/pdf\.worker\.mjs$/);
    expect(resolveWorkerSource()).not.toContain("nowhere");
  });
});

describe("text layer assembly", () => {
  it("joins runs into readable text and keeps line breaks", () => {
    expect(compactText([
      { str: "Updated", hasEOL: false },
      { str: "January 2026", hasEOL: true },
      { str: "Small Business Improvement Fund", hasEOL: false },
      { str: ",", hasEOL: false },
      { str: "SBIF", hasEOL: false },
    ])).toBe("Updated January 2026\nSmall Business Improvement Fund, SBIF");
  });

  it("drops null bytes and collapses runaway blank lines", () => {
    expect(compactText([
      { str: "A\u0000B", hasEOL: true },
      { str: "", hasEOL: true },
      { str: "", hasEOL: true },
      { str: "", hasEOL: true },
      { str: "End", hasEOL: false },
    ])).toBe("AB\n\nEnd");
  });
});
