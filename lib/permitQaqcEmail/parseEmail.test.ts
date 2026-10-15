import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmailParseError, parseEmailFile } from "./parseEmail";

const SIMPLE_EML = [
  "From: SampleConsultant Architects <user@example.com>",
  "To: STUDIO Review <user@example.com>",
  "Subject: 914 Example Ave Example City Revision 1. - Architect Review and Stamp Request",
  "Date: Sun, 26 Jul 2026 10:00:00 -0500",
  'Content-Type: text/plain; charset="utf-8"',
  "",
  "Please review and stamp the attached revised drawing set.",
  "",
].join("\r\n");

const MULTIPART_EML = [
  "From: SampleConsultant Architects <user@example.com>",
  "To: STUDIO Review <user@example.com>",
  "Subject: Revised set attached",
  "Date: Mon, 27 Jul 2026 09:00:00 -0500",
  'Content-Type: multipart/mixed; boundary="mi-test-boundary"',
  "",
  "--mi-test-boundary",
  'Content-Type: text/plain; charset="utf-8"',
  "",
  "See attached.",
  "",
  "--mi-test-boundary",
  "Content-Type: application/pdf",
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="914Exampleplans.pdf"',
  "",
  Buffer.from("not a real pdf, just test bytes").toString("base64"),
  "",
  "--mi-test-boundary--",
  "",
].join("\r\n");

describe("permit QAQC email parsing", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-permit-qaqc-email-"));
    fs.mkdirSync(path.join(root, "Received", "26_0726"), { recursive: true });
    fs.writeFileSync(path.join(root, "Received", "26_0726", "request.eml"), SIMPLE_EML);
    fs.writeFileSync(path.join(root, "Received", "26_0726", "with-attachment.eml"), MULTIPART_EML);
    fs.writeFileSync(path.join(root, "Received", "26_0726", "not-an-email.txt"), "plain text");
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("extracts subject/from/to/date/body from a plain-text email", async () => {
    const parsed = await parseEmailFile(root, ["Received", "26_0726", "request.eml"]);
    expect(parsed.subject).toBe("914 Example Ave Example City Revision 1. - Architect Review and Stamp Request");
    expect(parsed.from).toContain("user@example.com");
    expect(parsed.to).toContain("user@example.com");
    expect(parsed.date).toBe(new Date("2026-07-26T15:00:00.000Z").toISOString());
    expect(parsed.textBody).toBe("Please review and stamp the attached revised drawing set.");
    expect(parsed.attachmentFilenames).toEqual([]);
  });

  it("lists attachment filenames from a multipart email without decoding their content", async () => {
    const parsed = await parseEmailFile(root, ["Received", "26_0726", "with-attachment.eml"]);
    expect(parsed.attachmentFilenames).toEqual(["914Exampleplans.pdf"]);
    expect(parsed.textBody).toBe("See attached.");
  });

  it("refuses to parse a non-.eml file even if it exists at the requested path", async () => {
    await expect(parseEmailFile(root, ["Received", "26_0726", "not-an-email.txt"])).rejects.toThrow(EmailParseError);
  });

  it("refuses a missing file", async () => {
    await expect(parseEmailFile(root, ["Received", "26_0726", "missing.eml"])).rejects.toThrow(EmailParseError);
  });

  it("refuses a path that escapes the Dropbox folder", async () => {
    await expect(parseEmailFile(root, ["..", "outside.eml"])).rejects.toThrow(EmailParseError);
  });
});
