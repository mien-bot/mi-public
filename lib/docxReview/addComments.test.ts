import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { addCommentsToDocxBuffer } from "./addComments";

async function buildFixtureDocx(paragraphTexts: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "word/_rels/document.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      "</Relationships>",
  );
  const body = paragraphTexts
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
    .join("");
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("addCommentsToDocxBuffer", () => {
  it("anchors a comment to the paragraph containing the anchor text", async () => {
    const fixture = await buildFixtureDocx(["Year Built: 1888", "Some other paragraph"]);
    const result = await addCommentsToDocxBuffer(fixture, [
      { anchorText: "1888", comment: "Conflicts with 1895 elsewhere in the doc." },
    ]);

    expect(result.missing).toEqual([]);
    expect(result.placed).toEqual([{ id: 0, anchorText: "1888" }]);

    const outZip = await JSZip.loadAsync(result.buffer);
    const documentXml = await outZip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain('<w:commentRangeStart w:id="0"/>');
    expect(documentXml).toContain('<w:commentRangeEnd w:id="0"/>');
    expect(documentXml).toContain('<w:commentReference w:id="0"/>');

    const commentsXml = await outZip.file("word/comments.xml")!.async("string");
    expect(commentsXml).toContain('w:comment w:id="0"');
    expect(commentsXml).toContain("Conflicts with 1895 elsewhere in the doc.");

    const contentTypes = await outZip.file("[Content_Types].xml")!.async("string");
    expect(contentTypes).toContain("wordprocessingml.comments+xml");

    const rels = await outZip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain("comments.xml");
  });

  it("reports unmatched anchors as missing instead of throwing", async () => {
    const fixture = await buildFixtureDocx(["Only paragraph"]);
    const result = await addCommentsToDocxBuffer(fixture, [
      { anchorText: "nonexistent phrase", comment: "won't be placed" },
    ]);

    expect(result.placed).toEqual([]);
    expect(result.missing).toEqual(["nonexistent phrase"]);
  });

  it("does not reuse the same paragraph for two different anchors", async () => {
    const fixture = await buildFixtureDocx(["Ward 8 mentioned here", "Ward 8 mentioned again here"]);
    const result = await addCommentsToDocxBuffer(fixture, [
      { anchorText: "Ward 8", comment: "first mention" },
      { anchorText: "Ward 8", comment: "second mention" },
    ]);

    expect(result.missing).toEqual([]);
    expect(result.placed).toHaveLength(2);
    expect(result.placed[0].id).toBe(0);
    expect(result.placed[1].id).toBe(1);

    const outZip = await JSZip.loadAsync(result.buffer);
    const documentXml = await outZip.file("word/document.xml")!.async("string");
    // Each paragraph should have gotten exactly one comment reference, not both on the first.
    const paragraphs = documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)!;
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toContain('w:id="0"');
    expect(paragraphs[0]).not.toContain('w:id="1"');
    expect(paragraphs[1]).toContain('w:id="1"');
    expect(paragraphs[1]).not.toContain('w:id="0"');
  });

  it("leaves the underlying document text unchanged", async () => {
    const fixture = await buildFixtureDocx(["Zoning District RS-3"]);
    const result = await addCommentsToDocxBuffer(fixture, [
      { anchorText: "RS-3", comment: "conflicts with RT-4 later" },
    ]);
    const outZip = await JSZip.loadAsync(result.buffer);
    const documentXml = await outZip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain("Zoning District RS-3");
  });
});
