const fs = require("node:fs");
const path = require("node:path");

const MAX_PROPOSAL_FILE_BYTES = 1_000_000;

function readProposalFile(filePath, { fileSystem = fs } = {}) {
  const resolvedPath = path.resolve(filePath);
  if (path.extname(resolvedPath).toLowerCase() !== ".json") {
    throw new Error("Choose a .json proposal file.");
  }
  const stat = fileSystem.lstatSync(resolvedPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Choose a regular JSON file, not a folder or link.");
  }
  if (stat.size > MAX_PROPOSAL_FILE_BYTES) {
    throw new Error("The proposal file exceeds Mi's 1 MB limit.");
  }
  const rawReply = fileSystem.readFileSync(resolvedPath, "utf8").replace(/^\uFEFF/, "");
  return {
    canceled: false,
    name: path.basename(resolvedPath),
    path: resolvedPath,
    mtime: stat.mtime.toISOString(),
    bytes: Buffer.byteLength(rawReply, "utf8"),
    rawReply,
  };
}

async function pickProposalFile({ dialog, parent, defaultPath }) {
  const result = await dialog.showOpenDialog(parent, {
    title: "Choose a Mi proposal JSON file",
    defaultPath,
    properties: ["openFile"],
    filters: [{ name: "Mi proposal JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return readProposalFile(result.filePaths[0]);
}

module.exports = {
  MAX_PROPOSAL_FILE_BYTES,
  pickProposalFile,
  readProposalFile,
};
