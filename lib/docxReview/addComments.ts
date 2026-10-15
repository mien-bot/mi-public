import { copyFile, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";

export interface DocxComment {
  /** Unique substring of the target paragraph's visible text to anchor the comment to. */
  anchorText: string;
  /** The comment body Word/Google Docs will display. */
  comment: string;
}

export interface PlacedComment {
  id: number;
  anchorText: string;
}

export interface AddCommentsOptions {
  author?: string;
  initials?: string;
  /** ISO date string; defaults to now. */
  date?: string;
}

export interface AddCommentsResult {
  /** The rewritten .docx file bytes. */
  buffer: Buffer;
  placed: PlacedComment[];
  /** `anchorText` values that could not be matched to any paragraph. */
  missing: string[];
}

const DEFAULT_AUTHOR = "Mi";
const DEFAULT_INITIALS = "MI";

// w:p never nests inside another w:p (only tables nest, and their cells hold
// their own flat w:p elements), so a non-greedy scan of the raw XML finds
// every paragraph, table cell or not, in true document order with no
// hierarchy walking required.
const PARAGRAPH_SOURCE = "<w:p(?:\\s[^>]*)?>[\\s\\S]*?<\\/w:p>";

function escapeXmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function paragraphPlainText(paragraphXml: string): string {
  return unescapeXmlText(paragraphXml.replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, ""));
}

function buildCommentsXml(
  placed: PlacedComment[],
  byAnchor: Map<string, string>,
  author: string,
  initials: string,
  date: string,
): string {
  const body = placed
    .map(({ id, anchorText }) => {
      const text = escapeXmlText(byAnchor.get(anchorText) ?? "");
      return (
        `<w:comment w:id="${id}" w:author="${escapeXmlText(author)}" ` +
        `w:initials="${escapeXmlText(initials)}" w:date="${date}">` +
        `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>` +
        `</w:comment>`
      );
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    body +
    "</w:comments>"
  );
}

/**
 * Injects native Word comments into an existing .docx, anchored to the first
 * not-yet-used paragraph (searched in document order, table cells included)
 * whose visible text contains each comment's `anchorText`. Document content
 * is never rewritten — only comment range markers, a `w:commentReference`,
 * and the `word/comments.xml` part (plus its content-type and relationship
 * registrations) are added. Comments whose `anchorText` isn't found anywhere
 * are reported in `missing` rather than thrown, since a partial match is
 * still useful (e.g. review comments for text that got edited out).
 */
export async function addCommentsToDocxBuffer(
  input: Buffer,
  comments: DocxComment[],
  options: AddCommentsOptions = {},
): Promise<AddCommentsResult> {
  const author = options.author ?? DEFAULT_AUTHOR;
  const initials = options.initials ?? DEFAULT_INITIALS;
  const date = options.date ?? new Date().toISOString();

  const zip = await JSZip.loadAsync(input);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("Not a valid .docx: missing word/document.xml");
  }
  let documentXml = await documentFile.async("string");

  const usedParagraphIndexes = new Set<number>();
  const placed: PlacedComment[] = [];
  const missing: string[] = [];
  const byAnchor = new Map(comments.map((c) => [c.anchorText, c.comment]));

  for (const { anchorText } of comments) {
    const paragraphRegex = new RegExp(PARAGRAPH_SOURCE, "g");
    let match: RegExpExecArray | null;
    let paragraphIndex = -1;
    let foundThisComment = false;

    while ((match = paragraphRegex.exec(documentXml)) !== null) {
      paragraphIndex++;
      if (usedParagraphIndexes.has(paragraphIndex)) continue;
      if (!paragraphPlainText(match[0]).includes(anchorText)) continue;

      usedParagraphIndexes.add(paragraphIndex);
      const commentId = placed.length;
      const original = match[0];
      const openTagEnd = original.indexOf(">") + 1;
      const openTag = original.slice(0, openTagEnd);
      const innerContent = original.slice(openTagEnd, original.length - "</w:p>".length);

      const rangeStart = `<w:commentRangeStart w:id="${commentId}"/>`;
      const rangeEndAndRef =
        `<w:commentRangeEnd w:id="${commentId}"/>` +
        `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>` +
        `<w:commentReference w:id="${commentId}"/></w:r>`;
      const replacement = `${openTag}${rangeStart}${innerContent}${rangeEndAndRef}</w:p>`;

      documentXml = documentXml.slice(0, match.index) + replacement + documentXml.slice(match.index + original.length);
      placed.push({ id: commentId, anchorText });
      foundThisComment = true;
      break;
    }

    if (!foundThisComment) missing.push(anchorText);
  }

  zip.file("word/document.xml", documentXml);

  if (placed.length > 0) {
    zip.file("word/comments.xml", buildCommentsXml(placed, byAnchor, author, initials, date));

    const contentTypesFile = zip.file("[Content_Types].xml");
    if (contentTypesFile) {
      let contentTypes = await contentTypesFile.async("string");
      if (!contentTypes.includes("wordprocessingml.comments+xml")) {
        contentTypes = contentTypes.replace(
          "</Types>",
          '<Override PartName="/word/comments.xml" ' +
            'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>',
        );
      }
      zip.file("[Content_Types].xml", contentTypes);
    }

    const relsFile = zip.file("word/_rels/document.xml.rels");
    if (relsFile) {
      let rels = await relsFile.async("string");
      if (!rels.includes("comments.xml")) {
        rels = rels.replace(
          "</Relationships>",
          '<Relationship Id="rIdMiDocxReviewComments" ' +
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" ' +
            'Target="comments.xml"/></Relationships>',
        );
      }
      zip.file("word/_rels/document.xml.rels", rels);
    }
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return { buffer, placed, missing };
}

export interface AddCommentsToDocxFileOptions extends AddCommentsOptions {
  /** Where to write the result. Defaults to overwriting `filePath` in place. */
  outputPath?: string;
  /** If set, an untouched copy of the original is written here first. */
  backupPath?: string;
}

export interface AddCommentsToDocxFileResult {
  placed: PlacedComment[];
  missing: string[];
  outputPath: string;
}

/** File-path wrapper around {@link addCommentsToDocxBuffer} for real `.docx` files on disk. */
export async function addCommentsToDocxFile(
  filePath: string,
  comments: DocxComment[],
  options: AddCommentsToDocxFileOptions = {},
): Promise<AddCommentsToDocxFileResult> {
  const input = await readFile(filePath);
  if (options.backupPath) {
    await copyFile(filePath, options.backupPath);
  }
  const { buffer, placed, missing } = await addCommentsToDocxBuffer(input, comments, options);
  const outputPath = options.outputPath ?? filePath;
  await writeFile(outputPath, buffer);
  return { placed, missing, outputPath };
}
