const fs = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

// Shell associations for scripts/executables can run code. Reveal other file types
// in the file manager instead of executing terminal output as a command.
const DOCUMENT_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".tsv",
  ".txt", ".md", ".rtf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
  ".tif", ".tiff", ".dwg", ".dxf",
]);

function terminalLinkTarget(value, platform = process.platform) {
  if (typeof value !== "string" || !value || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("This terminal link is invalid.");
  }
  let target = value;
  if (/^https?:\/\//i.test(target)) {
    const url = new URL(target);
    if (url.username || url.password) throw new Error("Links containing login credentials cannot be opened.");
    return { kind: "web", target: url.href };
  }
  if (/^file:/i.test(target)) {
    const url = new URL(target);
    if (url.hostname && url.hostname !== "localhost") throw new Error("Only files on this computer can be opened.");
    target = fileURLToPath(url, { windows: platform === "win32" });
  }
  const paths = platform === "win32" ? path.win32 : path.posix;
  const absolute = platform === "win32" ? /^[a-z]:[\\/]/i.test(target) : target.startsWith("/");
  if (!absolute || /^[/\\]{2}/.test(target) || (platform === "win32" && target.slice(2).includes(":"))) {
    throw new Error("Use an absolute local file path or an HTTP(S) link.");
  }
  return { kind: "file", target: paths.normalize(target) };
}

async function openTerminalLink(value, shell) {
  const link = terminalLinkTarget(value);
  if (link.kind === "web") {
    await shell.openExternal(link.target);
    return { opened: "browser" };
  }
  let target;
  let info;
  try {
    target = await fs.realpath(link.target);
    // Recheck after resolving symlinks/junctions, including network/device paths.
    terminalLinkTarget(target);
    info = await fs.stat(target);
  } catch {
    throw new Error("This local file is unavailable. Check that it exists on this computer.");
  }
  if (!info.isFile() && !info.isDirectory()) throw new Error("This link is not a regular file or folder.");
  if (info.isFile() && !DOCUMENT_EXTENSIONS.has(path.extname(target).toLowerCase())) {
    shell.showItemInFolder(target);
    return { opened: "revealed" };
  }
  const error = await shell.openPath(target);
  if (error) throw new Error("The file could not be opened. Check its default application and try again.");
  return { opened: info.isDirectory() ? "folder" : "file" };
}

module.exports = { terminalLinkTarget, openTerminalLink };
