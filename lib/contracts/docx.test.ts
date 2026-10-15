import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildContractDocx, safeContractFilename } from "@/lib/contracts/docx";
import { contractDraftInputSchema } from "@/lib/contracts/schema";
import { createContractDraft } from "@/lib/contracts/templates";

describe("contract DOCX drafts", () => {
  it("requires reviewed project and client fields", () => {
    const result = contractDraftInputSchema.safeParse(createContractDraft());
    expect(result.success).toBe(false);
  });

  it("builds an editable Word package without leaking private reference paths", async () => {
    const draft = createContractDraft("concept-design");
    draft.clientName = "A & B <Owners>";
    draft.projectName = "Test / Project";
    const bytes = await buildContractDocx(contractDraftInputSchema.parse(draft));
    const zip = await JSZip.loadAsync(bytes);
    const document = await zip.file("word/document.xml")?.async("string");

    expect(document).toContain("A &amp; B &lt;Owners&gt;");
    expect(document).toContain("DRAFT — REVIEW BEFORE SENDING");
    expect(document).toContain("Terms and Conditions");
    expect(document).not.toContain("E:\\Dropbox");
    expect(zip.file("word/numbering.xml")).not.toBeNull();
    expect(zip.file("word/styles.xml")).not.toBeNull();
  });

  it("creates a filesystem-safe draft filename", () => {
    expect(safeContractFilename("1002 S Example Blvd: Permit / Phase 1")).toBe("1002-S-Example-Blvd-Permit-Phase-1-draft.docx");
  });
});
