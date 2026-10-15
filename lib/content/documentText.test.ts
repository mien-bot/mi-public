import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractDocumentText,
  extractDocxText,
  extractVttText,
  pastedSource,
} from "./documentText";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempFile(name: string, content: string | Buffer): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-doc-text-"));
  roots.push(root);
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

async function docxBuffer(documentXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("extractDocxText", () => {
  it("reads paragraphs as lines using the existing zip dependency", async () => {
    const bytes = await docxBuffer(
      "<w:document><w:body>" +
      "<w:p><w:r><w:t>Section 10.</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>Two times fees.</w:t></w:r></w:p>" +
      "</w:body></w:document>",
    );
    const { text } = await extractDocxText(bytes);
    expect(text).toContain("Section 10.");
    expect(text).toContain("Two times fees.");
    expect(text).not.toContain("<w:");
  });

  it("warns when a document carries tracked changes", async () => {
    // Contract revisions arrive as .docx, and a redline's deleted text must not read as current.
    const bytes = await docxBuffer(
      "<w:document><w:body><w:p><w:del><w:r><w:delText>fee cap</w:delText></w:r></w:del>" +
      "<w:ins><w:r><w:t>two times fees</w:t></w:r></w:ins></w:p></w:body></w:document>",
    );
    const { warnings } = await extractDocxText(bytes);
    expect(warnings.join(" ")).toContain("tracked changes");
  });

  it("reports a docx with no document part rather than throwing", async () => {
    const zip = new JSZip();
    zip.file("docProps/app.xml", "<x/>");
    const { text, warnings } = await extractDocxText(await zip.generateAsync({ type: "nodebuffer" }));
    expect(text).toBe("");
    expect(warnings.join(" ")).toContain("could not be read");
  });

  it("decodes escaped entities", async () => {
    const bytes = await docxBuffer("<w:document><w:body><w:p><w:r><w:t>STUDIO &amp; Owner</w:t></w:r></w:p></w:body></w:document>");
    expect((await extractDocxText(bytes)).text).toContain("STUDIO & Owner");
  });
});

describe("extractVttText", () => {
  it("keeps speech and speaker labels while dropping cue numbers and timings", () => {
    const { text } = extractVttText([
      "WEBVTT",
      "",
      "1",
      "00:00:01.000 --> 00:00:04.000",
      "Alex: The liability cap is the open item.",
      "",
      "2",
      "00:00:04.500 --> 00:00:08.000",
      "Casey: I want two times fees.",
    ].join("\n"));

    expect(text).toBe("Alex: The liability cap is the open item.\nCasey: I want two times fees.");
    expect(text).not.toContain("-->");
    expect(text).not.toContain("WEBVTT");
  });

  it("collapses the repeated lines a rolling-caption export produces", () => {
    const { text } = extractVttText([
      "WEBVTT",
      "00:00:01.000 --> 00:00:02.000",
      "Two times fees",
      "00:00:02.000 --> 00:00:03.000",
      "Two times fees",
      "00:00:03.000 --> 00:00:04.000",
      "Agreed.",
    ].join("\n"));
    expect(text).toBe("Two times fees\nAgreed.");
  });
});

describe("extractDocumentText", () => {
  it("hashes the original bytes, not the extracted text", async () => {
    const filePath = tempFile("notes.txt", "Phase 1 is $2,000.");
    const result = await extractDocumentText(filePath);
    expect(result.text).toBe("Phase 1 is $2,000.");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sha256).toBe(pastedSource("Phase 1 is $2,000.").sha256);
  });

  it("reads a .vtt transcript from disk", async () => {
    const filePath = tempFile("call.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nAgreed on two rounds.");
    expect((await extractDocumentText(filePath)).text).toBe("Agreed on two rounds.");
  });

  it("refuses a file type it cannot read, naming what it can", async () => {
    const filePath = tempFile("drawing.dwg", "binary");
    await expect(extractDocumentText(filePath)).rejects.toThrow(/\.pdf/);
  });

  it("warns rather than failing when a file yields no text", async () => {
    const filePath = tempFile("empty.txt", "   ");
    const result = await extractDocumentText(filePath);
    expect(result.characters).toBe(0);
    expect(result.warnings.join(" ")).toContain("still attached as evidence");
  });
});
