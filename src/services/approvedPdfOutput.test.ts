import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeStagedPdf, preflightPdfOutput, stageAndRenderPdf } from "./approvedPdfOutput";
import { MI_PDF_MARKER, brandPdfWithMi } from "./pdfBranding";

const roots: string[] = [];

function onePagePdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length 45 >>\nstream\nBT /F1 18 Tf 40 120 Td (Meeting agenda) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("approved PDF output", () => {
  it("refuses publication if even one page is too small for the Mi mark", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-pdf-output-"));
    roots.push(root);
    const workspace = path.join(root, "Mi");
    const scratchpad = path.join(workspace, "scratchpad");
    fs.mkdirSync(scratchpad, { recursive: true });
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    pdf.addPage([10, 10]);
    const source = path.join(scratchpad, "mixed.pdf");
    const output = path.join(root, "published.pdf");
    fs.writeFileSync(source, await pdf.save());
    const preflight = preflightPdfOutput({ source_path: source, output_path: output, overwrite: false, attach_to_task: false }, workspace);
    await expect(stageAndRenderPdf(preflight, path.join(root, "staging"))).rejects.toThrow(/Mi mark on every page/);
    expect(fs.existsSync(output)).toBe(false);
  });

  it("renders every page before atomically creating the exact external target", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-pdf-output-"));
    roots.push(root);
    const workspace = path.join(root, "project", "Mi");
    const scratchpad = path.join(workspace, "scratchpad");
    const external = path.join(root, "approved-output");
    fs.mkdirSync(scratchpad, { recursive: true });
    fs.mkdirSync(external);
    const source = path.join(scratchpad, "agenda.pdf");
    const output = path.join(external, "agenda.pdf");
    fs.writeFileSync(source, onePagePdf());

    const preflight = preflightPdfOutput({
      source_path: source,
      output_path: output,
      overwrite: false,
      attach_to_task: true,
    }, workspace);
    const staged = await stageAndRenderPdf(preflight, path.join(root, "staging"));
    expect(staged.pageCount).toBe(1);
    expect(staged.renderedPages).toHaveLength(1);
    expect(fs.statSync(staged.renderedPages[0]).size).toBeGreaterThan(100);

    const result = finalizeStagedPdf(staged, preflight, false);
    expect(result).toMatchObject({ absolutePath: output, pageCount: 1, overwritten: false });
    // What lands at the approved path is exactly the branded file that was rendered and
    // reviewed -- not the agent's source, and not a re-derived copy of it.
    expect(fs.readFileSync(output)).toEqual(fs.readFileSync(staged.stagedPath));
  });

  it("stamps the Mi mark on what it publishes and leaves the agent's source file alone", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-pdf-output-"));
    roots.push(root);
    const workspace = path.join(root, "project", "Mi");
    const scratchpad = path.join(workspace, "scratchpad");
    const external = path.join(root, "approved-output");
    fs.mkdirSync(scratchpad, { recursive: true });
    fs.mkdirSync(external);
    const source = path.join(scratchpad, "agenda.pdf");
    const output = path.join(external, "agenda.pdf");
    const original = onePagePdf();
    fs.writeFileSync(source, original);

    const preflight = preflightPdfOutput({
      source_path: source,
      output_path: output,
      overwrite: false,
      attach_to_task: true,
    }, workspace);
    const staged = await stageAndRenderPdf(preflight, path.join(root, "staging"));

    expect(staged.branding).toMatchObject({ applied: true, pagesStamped: 1 });
    expect(fs.readFileSync(source)).toEqual(original);

    finalizeStagedPdf(staged, preflight, false);
    // `updateMetadata` defaults to true and would stamp pdf-lib over Producer in the
    // reader itself, hiding what the file on disk actually says.
    const published = await PDFDocument.load(fs.readFileSync(output), { updateMetadata: false });
    expect(published.getKeywords()).toContain(MI_PDF_MARKER);
    expect(published.getProducer()).toBe("Mi");
  });

  it("stamps an already-marked PDF exactly once", async () => {
    const first = await brandPdfWithMi(onePagePdf());
    expect(first).toMatchObject({ applied: true, pagesStamped: 1 });

    const second = await brandPdfWithMi(first.bytes);
    expect(second.applied).toBe(false);
    expect(second.reason).toMatch(/already carries the Mi mark/);
    expect(second.bytes).toEqual(first.bytes);
  });

  it("reports the reason instead of throwing when a PDF cannot be stamped", async () => {
    const result = await brandPdfWithMi(Buffer.from("not a pdf at all"));
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/could not open this PDF/);
    expect(result.pagesStamped).toBe(0);
  });

  it("requires a new overwrite-specific preview when the exact target exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-pdf-output-"));
    roots.push(root);
    const workspace = path.join(root, "Mi");
    const scratchpad = path.join(workspace, "scratchpad");
    fs.mkdirSync(scratchpad, { recursive: true });
    const source = path.join(scratchpad, "agenda.pdf");
    const output = path.join(root, "agenda.pdf");
    fs.writeFileSync(source, onePagePdf());
    fs.writeFileSync(output, "existing");
    expect(() => preflightPdfOutput({
      source_path: source,
      output_path: output,
      overwrite: false,
      attach_to_task: false,
    }, workspace)).toThrow(/already exists.*overwrite=true/);
  });
});
