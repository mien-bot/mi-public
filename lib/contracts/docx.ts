import JSZip from "jszip";
import type { ContractDraftInput } from "@/lib/contracts/schema";
import { getContractTemplate, standardContractTerms } from "@/lib/contracts/templates";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function preserveSpace(text: string): string {
  return `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`;
}

function run(text: string, options: { bold?: boolean; italic?: boolean; size?: number } = {}): string {
  const properties = [
    options.bold ? "<w:b/>" : "",
    options.italic ? "<w:i/>" : "",
    options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : "",
  ].join("");
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}${preserveSpace(text)}</w:r>`;
}

function paragraph(
  contents: string,
  options: { style?: string; align?: "left" | "center" | "right"; keepNext?: boolean; pageBreakBefore?: boolean } = {},
): string {
  const properties = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : "",
    options.align ? `<w:jc w:val="${options.align}"/>` : "",
    options.keepNext ? "<w:keepNext/>" : "",
    options.pageBreakBefore ? "<w:pageBreakBefore/>" : "",
  ].join("");
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${contents}</w:p>`;
}

function textParagraph(text: string, options: Parameters<typeof paragraph>[1] = {}): string {
  return paragraph(run(text), options);
}

function listParagraph(text: string, numId: 1 | 2): string {
  return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(text)}</w:p>`;
}

function labelParagraph(label: string, value: string): string {
  return paragraph(`${run(`${label}: `, { bold: true })}${run(value || "—")}`);
}

function tableCell(contents: string, width: number, options: { bold?: boolean; fill?: string } = {}): string {
  const fill = options.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${options.fill}"/>` : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fill}</w:tcPr>${paragraph(run(contents, { bold: options.bold }))}</w:tc>`;
}

function feeTable(fees: ContractDraftInput["fees"]): string {
  const rows = [
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tableCell("Service / phase", 6840, { bold: true, fill: "E8EEF5" })}${tableCell("Fee", 2520, { bold: true, fill: "E8EEF5" })}</w:tr>`,
    ...fees.map((fee) => `<w:tr>${tableCell(fee.label, 6840)}${tableCell(fee.amount, 2520)}</w:tr>`),
  ].join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B9C1CC"/><w:left w:val="single" w:sz="4" w:color="B9C1CC"/><w:bottom w:val="single" w:sz="4" w:color="B9C1CC"/><w:right w:val="single" w:sz="4" w:color="B9C1CC"/><w:insideH w:val="single" w:sz="4" w:color="D6DBE1"/><w:insideV w:val="single" w:sz="4" w:color="D6DBE1"/></w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:start w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:end w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="6840"/><w:gridCol w:w="2520"/></w:tblGrid>${rows}</w:tbl>`;
}

function signatureTable(draft: ContractDraftInput): string {
  const client = `${draft.clientName}\nClient signature\nDate`;
  const firm = `${draft.firmSigners.join(" / ")}\n${draft.preparedBy}\nSignature(s) / Date`;
  const signatureCell = (value: string) => {
    const [name, organization, label] = value.split("\n");
    const lines = [
      textParagraph(name),
      organization ? textParagraph(organization) : "",
      textParagraph("________________________________"),
      label ? textParagraph(label) : "",
    ].join("");
    return `<w:tc><w:tcPr><w:tcW w:w="4560" w:type="dxa"/><w:tcMar><w:top w:w="120" w:type="dxa"/><w:start w:w="0" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:end w:w="240" w:type="dxa"/></w:tcMar></w:tcPr>${lines}</w:tc>`;
  };
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4560"/><w:gridCol w:w="4560"/></w:tblGrid><w:tr>${signatureCell(client)}${signatureCell(firm)}</w:tr></w:tbl>`;
}

function formatProposalDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(date);
}

function documentXml(draft: ContractDraftInput): string {
  const template = getContractTemplate(draft.templateId);
  const location = [draft.projectAddress, draft.projectArea].filter(Boolean).join(" · ");
  const body = [
    textParagraph("DRAFT — REVIEW BEFORE SENDING", { style: "DraftNotice", align: "center" }),
    textParagraph(formatProposalDate(draft.proposalDate)),
    labelParagraph("TO", draft.clientName),
    draft.clientCompany ? labelParagraph("COMPANY", draft.clientCompany) : "",
    draft.contactInformation ? labelParagraph("CONTACT", draft.contactInformation) : "",
    labelParagraph("FROM", draft.preparedBy),
    labelParagraph("RE", draft.projectName),
    location ? textParagraph(location) : "",
    textParagraph(template.proposalTitle, { style: "Title", align: "center" }),
    textParagraph(`Example Studio is pleased to submit this proposal for ${draft.projectDescription.charAt(0).toLowerCase()}${draft.projectDescription.slice(1)}`),
    textParagraph("This document is a draft assembled from firm reference formats. Project facts, scope, fees, insurance requirements, and legal terms must be reviewed and approved by an authorized firm principal before it is issued."),
    textParagraph("Scope of Services", { style: "Heading1", keepNext: true }),
    ...draft.services.map((item) => listParagraph(item, 1)),
    textParagraph("Services by Client or Others", { style: "Heading1", keepNext: true }),
    ...draft.clientResponsibilities.map((item) => listParagraph(item, 1)),
    textParagraph("Assumptions and Understandings", { style: "Heading1", keepNext: true }),
    ...draft.assumptions.map((item) => listParagraph(item, 1)),
    textParagraph("Fee Breakdown", { style: "Heading1", keepNext: true }),
    feeTable(draft.fees),
    textParagraph("Reimbursable Expenses", { style: "Heading1", keepNext: true }),
    textParagraph(draft.reimbursableMarkup
      ? `Reimbursable project expenses will be invoiced at cost plus ${draft.reimbursableMarkup}. Expenses may include printing, plotting, shipping, travel, filing, delivery, and similar project-specific costs.`
      : "Reimbursable project expenses will be invoiced separately at cost unless otherwise agreed in writing."),
    textParagraph("Additional Services", { style: "Heading1", keepNext: true }),
    textParagraph("Services caused by a material change in the approved scope, program, schedule, design direction, regulations, or information furnished by others are additional services. No additional service will be performed for an additional fee without the client's prior written authorization."),
    textParagraph("Retainer and Payment Schedule", { style: "Heading1", keepNext: true }),
    ...draft.retainerSchedule.map((item) => listParagraph(item, 1)),
    textParagraph("Invoices are due upon receipt unless another payment period is stated in writing. The firm may suspend services after written notice if an undisputed invoice remains unpaid."),
    textParagraph("Terms and Conditions", { style: "Heading1", keepNext: true, pageBreakBefore: true }),
    ...standardContractTerms.map((term) => listParagraph(`${term.title}: ${term.text}`, 2)),
    draft.additionalTerms ? textParagraph("Project-Specific Additional Terms", { style: "Heading1", keepNext: true }) : "",
    draft.additionalTerms ? textParagraph(draft.additionalTerms) : "",
    textParagraph("Hourly Rates", { style: "Heading1", keepNext: true }),
    textParagraph(draft.hourlyRate ? `Additional services may be provided at ${draft.hourlyRate} or for a separately negotiated fee.` : "Additional services may be provided for a separately negotiated fee."),
    textParagraph("Acceptance", { style: "Heading1", keepNext: true }),
    textParagraph("The parties accept this proposal by signing below. The signed proposal and its listed attachments constitute the agreement unless superseded by a later written agreement signed by both parties."),
    signatureTable(draft),
    textParagraph("END OF DRAFT", { style: "DraftNotice", align: "center" }),
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>`,
  ].filter(Boolean).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WORD_NS}"><w:body>${body}</w:body></w:document>`;
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${WORD_NS}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="200"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="DraftNotice"><w:name w:val="Draft Notice"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="160"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="9B1C1C"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${WORD_NS}">
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="100"/></w:pPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

export async function buildContractDocx(draft: ContractDraftInput): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  zip.folder("word")?.file("document.xml", documentXml(draft));
  zip.folder("word")?.file("styles.xml", stylesXml);
  zip.folder("word")?.file("numbering.xml", numberingXml);
  zip.folder("word")?.file("settings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${WORD_NS}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:compat/></w:settings>`);
  zip.folder("word")?.folder("_rels")?.file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`);
  zip.folder("docProps")?.file("core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Contract Draft</dc:title><dc:creator>STUDIO</dc:creator><dc:description>Draft generated in Mi for human review.</dc:description></cp:coreProperties>`);
  zip.folder("docProps")?.file("app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Mi</Application><AppVersion>1.0</AppVersion></Properties>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export function safeContractFilename(projectName: string): string {
  const clean = projectName.normalize("NFKD").replace(/[^a-zA-Z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80);
  return `${clean || "Contract"}-draft.docx`;
}
