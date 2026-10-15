import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

const {
  addAttachmentContext,
  docxPlainText,
  prepareAgentAttachments,
} = require("./agentAttachments");

const roots: string[] = [];

function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "mi-agent-attachment-"));
  roots.push(value);
  return value;
}

function simplePdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 4 0 R /Annots [5 0 R] >>",
    "<< /Length 46 >>\nstream\nBT /F1 12 Tf 72 720 Td (Hello Mi PDF) Tj ET\nendstream",
    "<< /Type /Annot /Subtype /Link /Rect [72 700 200 720] /A << /S /URI /URI (https://example.com) >> >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

afterEach(() => {
  for (const value of roots.splice(0)) fs.rmSync(value, { recursive: true, force: true });
});

describe("agent attachments", () => {
  it("extracts readable DOCX text and gives the agent explicit review instructions", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", [
      '<w:document xmlns:w="urn:test"><w:body>',
      "<w:p><w:r><w:t>Termination clause</w:t></w:r></w:p>",
      "<w:p><w:r><w:t>Thirty days notice.</w:t></w:r></w:p>",
      "</w:body></w:document>",
    ].join(""));
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    const prepared = await prepareAgentAttachments({
      root: root(),
      requestId: "request-1",
      attachments: [{
        name: "agreement.docx",
        dataUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${bytes.toString("base64")}`,
      }],
    });

    expect(prepared).toHaveLength(1);
    expect(fs.readFileSync(prepared[0].extractedTextPath, "utf8")).toContain("Termination clause");
    const prompt = addAttachmentContext("Review this contract.", prepared);
    expect(prompt).toContain("Inspect every relevant attachment before answering");
    expect(prompt).toContain("agreement.docx");
    expect(prompt).toContain("local extraction");
  });

  it("rejects unsupported binary files and cleans the scratch request directory", async () => {
    const base = root();
    await expect(prepareAgentAttachments({
      root: base,
      requestId: "request-2",
      attachments: [{
        name: "installer.exe",
        dataUrl: "data:application/octet-stream;base64,AA==",
      }],
    })).rejects.toThrow(/not a supported attachment/i);
    expect(fs.existsSync(path.join(base, "request-2"))).toBe(false);
  });

  it("extracts attached PDF text and links locally while stating the visual limitation", async () => {
    const bytes = simplePdf();
    const prepared = await prepareAgentAttachments({
      root: root(),
      requestId: "request-pdf",
      attachments: [{
        name: "evidence.pdf",
        dataUrl: `data:application/pdf;base64,${bytes.toString("base64")}`,
      }],
    });

    const extraction = JSON.parse(fs.readFileSync(prepared[0].extractedTextPath, "utf8"));
    expect(extraction.summary).toMatchObject({
      page_count: 1,
      pages_with_text: 1,
      link_annotations: 1,
      visual_review: "not_performed",
    });
    expect(extraction.pages[0].text).toContain("Hello Mi PDF");
    expect(extraction.pages[0].links[0].url).toBe("https://example.com/");

    const prompt = addAttachmentContext("Review this PDF.", prepared);
    expect(prompt).toContain("read its local extraction first");
    expect(prompt).toContain("does not prove visual layout");
  });

  it("turns WordprocessingML into bounded plain text", () => {
    expect(docxPlainText("<w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p>")).toBe("A & B");
  });
});
