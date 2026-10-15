import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { simpleParser } from "mailparser";
import { extractPdfDocument } from "@/electron/pdfExtraction";
import { hashContent } from "./atomicContentWrite";

/** Matches the PDF inspector's ceiling so one source cannot dominate a meeting record. */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_SOURCE_CHARACTERS = 200_000;

export const SUPPORTED_SOURCE_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".eml", ".vtt"] as const;

export interface ExtractedDocument {
  text: string;
  characters: number;
  /** Of the original bytes, not the extracted text: the source is what is being attested. */
  sha256: string;
  extension: string;
  warnings: string[];
  truncated: boolean;
}

function finish(text: string, bytes: Buffer, extension: string, warnings: string[]): ExtractedDocument {
  const trimmed = text.trim();
  const truncated = trimmed.length > MAX_SOURCE_CHARACTERS;
  const capped = truncated ? trimmed.slice(0, MAX_SOURCE_CHARACTERS) : trimmed;
  if (truncated) {
    warnings.push(
      `Extracted text was capped at ${MAX_SOURCE_CHARACTERS.toLocaleString()} characters. The full file remains attached.`,
    );
  }
  if (capped.length === 0) {
    warnings.push("No readable text was extracted. The file is still attached as evidence.");
  }
  return {
    text: capped,
    characters: capped.length,
    sha256: hashContent(bytes),
    extension,
    warnings,
    truncated,
  };
}

/**
 * Plain text from a Word document, using the JSZip already in the dependency tree.
 *
 * A .docx is a zip of XML, so this reads `word/document.xml` directly rather than adding a
 * parser dependency. It is deliberately shallow: paragraph and break boundaries become
 * newlines and everything else is dropped. Tracked changes, comments, and headers are not
 * read, which matters here because contract revisions arrive as .docx and a redline's
 * *deleted* text must not silently read as current.
 */
export async function extractDocxText(bytes: Buffer): Promise<{ text: string; warnings: string[] }> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(bytes);
  const document = zip.file("word/document.xml");
  if (!document) {
    return { text: "", warnings: ["This .docx has no word/document.xml and could not be read."] };
  }
  const xml = await document.async("string");

  if (/<w:(ins|del)\b/.test(xml)) {
    warnings.push(
      "This document contains tracked changes. Extracted text reflects the markup as stored, not an accepted-changes view — read the original before relying on it.",
    );
  }

  const text = xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n");
  return { text, warnings };
}

const VTT_TIMESTAMP = /^\d{2}:\d{2}(:\d{2})?\.\d{3}\s+-->\s+\d{2}:\d{2}(:\d{2})?\.\d{3}/;

/**
 * Spoken text from a WebVTT transcript.
 *
 * Cue numbers and timing lines are dropped; speaker labels are kept, because "who said
 * this" is exactly what makes a transcript worth more than a summary. Consecutive
 * duplicate lines are collapsed, since rolling-caption exports repeat each line as it grows.
 */
export function extractVttText(raw: string): { text: string; warnings: string[] } {
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "WEBVTT" || trimmed.startsWith("NOTE ")) continue;
    if (VTT_TIMESTAMP.test(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue;
    const cleaned = trimmed.replace(/<\/?[cv][^>]*>/g, "");
    if (kept[kept.length - 1] === cleaned) continue;
    kept.push(cleaned);
  }
  return { text: kept.join("\n"), warnings: [] };
}

/**
 * Reads one meeting source into text.
 *
 * The extracted text is a convenience; the caller keeps the original file and its hash,
 * because a summary drops things a transcript contains. Anything unreadable returns empty
 * text with a warning rather than throwing, so attaching a source never fails outright.
 */
export async function extractDocumentText(filePath: string): Promise<ExtractedDocument> {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("Choose a file.");
  if (stat.size > MAX_SOURCE_BYTES) {
    throw new Error(`This file exceeds Mi's ${MAX_SOURCE_BYTES / (1024 * 1024)} MB limit for meeting sources.`);
  }
  const extension = path.extname(filePath).toLowerCase();
  const bytes = fs.readFileSync(filePath);

  if (extension === ".pdf") {
    const document = await extractPdfDocument(filePath);
    const text = document.pages.map((page: { text: string }) => page.text).join("\n\n");
    return finish(text, bytes, extension, [...document.warnings]);
  }
  if (extension === ".docx") {
    const { text, warnings } = await extractDocxText(bytes);
    return finish(text, bytes, extension, warnings);
  }
  if (extension === ".eml") {
    const parsed = await simpleParser(bytes);
    const header = [
      parsed.subject ? `Subject: ${parsed.subject}` : "",
      parsed.from?.text ? `From: ${parsed.from.text}` : "",
      parsed.date ? `Date: ${parsed.date.toISOString()}` : "",
    ].filter(Boolean).join("\n");
    const body = parsed.text ?? "";
    const warnings = parsed.text ? [] : ["This message had no plain-text body; HTML was not converted."];
    return finish(`${header}\n\n${body}`, bytes, extension, warnings);
  }
  if (extension === ".vtt") {
    const { text, warnings } = extractVttText(bytes.toString("utf8"));
    return finish(text, bytes, extension, warnings);
  }
  if (extension === ".txt" || extension === ".md") {
    return finish(bytes.toString("utf8"), bytes, extension, []);
  }
  throw new Error(
    `Mi reads ${SUPPORTED_SOURCE_EXTENSIONS.join(", ")} as meeting sources. Paste the text instead.`,
  );
}

/** Text pasted directly, hashed the same way so both source kinds are attested alike. */
export function pastedSource(text: string): ExtractedDocument {
  const bytes = Buffer.from(text, "utf8");
  return finish(text, bytes, ".txt", []);
}
