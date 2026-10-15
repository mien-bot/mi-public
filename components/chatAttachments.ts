export const CHAT_ATTACHMENT_ACCEPT = [
  "image/*",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".rtf",
].join(",");

export const MAX_CHAT_ATTACHMENTS = 5;
export const MAX_CHAT_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md", ".rtf"]);

function extension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

export function chatAttachmentKind(name: string, type: string): "image" | "document" | null {
  if (type.startsWith("image/")) return "image";
  return SUPPORTED_EXTENSIONS.has(extension(name)) ? "document" : null;
}

export function chatAttachmentError(file: Pick<File, "name" | "size" | "type">): string | null {
  if (!chatAttachmentKind(file.name, file.type)) {
    return `"${file.name}" is not supported. Attach a PDF, DOCX, text, Markdown, RTF, or image file.`;
  }
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    return `"${file.name}" is larger than the 20 MB attachment limit.`;
  }
  return null;
}

export function isContractAttachment(name: string): boolean {
  return [".pdf", ".docx", ".rtf"].includes(extension(name));
}
