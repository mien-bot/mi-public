import { describe, expect, it } from "vitest";
import {
  chatAttachmentError,
  chatAttachmentKind,
  isContractAttachment,
} from "./chatAttachments";

describe("chat attachments", () => {
  it("accepts contract and reference formats while rejecting arbitrary binaries", () => {
    expect(chatAttachmentKind("agreement.pdf", "application/pdf")).toBe("document");
    expect(chatAttachmentKind("agreement.docx", "")).toBe("document");
    expect(chatAttachmentKind("photo.png", "image/png")).toBe("image");
    expect(chatAttachmentKind("installer.exe", "application/octet-stream")).toBeNull();
  });

  it("returns a visible size or format error", () => {
    expect(chatAttachmentError({ name: "bad.exe", type: "application/octet-stream", size: 10 })).toMatch(/not supported/i);
    expect(chatAttachmentError({ name: "large.pdf", type: "application/pdf", size: 21 * 1024 * 1024 })).toMatch(/20 MB/i);
  });

  it("recognizes common contract containers", () => {
    expect(isContractAttachment("proposal.docx")).toBe(true);
    expect(isContractAttachment("terms.pdf")).toBe(true);
    expect(isContractAttachment("notes.txt")).toBe(false);
  });
});
