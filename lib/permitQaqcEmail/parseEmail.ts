import fs from "node:fs";
import { simpleParser } from "mailparser";
import { resolveFileWithinDir } from "@/lib/content/fileServing";

export interface ParsedEmail {
  relativePath: string;
  subject: string | null;
  from: string | null;
  to: string | null;
  /** ISO 8601 timestamp, or null if the message had no parseable Date header. */
  date: string | null;
  textBody: string | null;
  attachmentFilenames: string[];
}

export class EmailParseError extends Error {
  constructor(message: string, readonly status: 400 | 404 = 400) {
    super(message);
  }
}

/**
 * Reads and parses a single .eml file living inside an engagement's real, confirmed
 * Dropbox folder. Read-only -- never writes, moves, or deletes the source file. Path
 * safety reuses resolveFileWithinDir (the same traversal guard the dropbox-file/
 * project-file/lead-dropbox-file routes already use), plus an extension check specific
 * to this module (fileServing.ts's resolver doesn't restrict by extension).
 */
export async function parseEmailFile(dropboxDir: string, segments: string[]): Promise<ParsedEmail> {
  const relativePath = segments.join("/");
  if (!relativePath.toLowerCase().endsWith(".eml")) {
    throw new EmailParseError(`Not a .eml file: "${relativePath}"`);
  }

  const resolved = resolveFileWithinDir(dropboxDir, segments);
  if (!resolved.ok) {
    throw new EmailParseError(resolved.message, resolved.status);
  }

  const raw = fs.readFileSync(resolved.absolutePath);
  const parsed = await simpleParser(raw);

  const to = Array.isArray(parsed.to)
    ? parsed.to.map((entry) => entry.text).join(", ")
    : (parsed.to?.text ?? null);

  return {
    relativePath,
    subject: parsed.subject?.trim() || null,
    from: parsed.from?.text?.trim() || null,
    to: to || null,
    date: parsed.date instanceof Date && !Number.isNaN(parsed.date.valueOf()) ? parsed.date.toISOString() : null,
    textBody: parsed.text?.trim() || null,
    attachmentFilenames: parsed.attachments.map((attachment) => attachment.filename || "(unnamed attachment)"),
  };
}
