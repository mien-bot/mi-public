const fs = require("node:fs");
const path = require("node:path");
const { generated, hash } = require("./agentHarness");

// This one shared reference is human-authorized. Never discover it by scanning
// engagement siblings, or grant agents access to the containing Dropbox folder.
const SOURCE_RELATIVE_PATH = "1.00 PROJECTS/PERMIT QAQC/CHICAGO-PERMIT-APPLICATION-GUIDANCE.md";
const REFERENCE_PATH = path.join("references", "chicago-permit-application-guidance.md");
const BUNDLED_PATH = path.join(__dirname, "..", "installer", "agent-harness", REFERENCE_PATH);
const MAX_BYTES = 256 * 1024;

function verifyGuidanceDestination(harnessRoot) {
  // Do not let a pre-existing reference-folder junction broaden this generator's
  // write/read scope. Repeat at apply time to catch replacement after preview.
  for (const relative of ["references", REFERENCE_PATH]) {
    const target = path.join(harnessRoot, relative);
    try {
      if (fs.lstatSync(target).isSymbolicLink()) throw new Error("Shared reference destination must stay inside this engagement's Mi workspace.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function readReference(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Shared guidance must be a bounded Markdown file.");
  const content = fs.readFileSync(file, "utf8");
  if (!content.trim()) throw new Error("Shared guidance is empty.");
  return content;
}

function sharedSource(dropboxRoot) {
  if (!dropboxRoot) return null;
  const root = fs.realpathSync(dropboxRoot);
  const file = fs.realpathSync(path.join(root, ...SOURCE_RELATIVE_PATH.split("/")));
  const relative = path.relative(root, file);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Shared guidance escaped the configured Dropbox root.");
  }
  return file;
}

function loadPermitQaqcGuidance({ settings, harnessRoot }) {
  verifyGuidanceDestination(harnessRoot);
  let content;
  let sourcePath = null;
  try {
    sourcePath = sharedSource(settings.dropboxRoot);
    if (sourcePath) content = readReference(sourcePath);
  } catch { sourcePath = null; }
  if (!content) {
    // Never downgrade a previously refreshed copy when Dropbox is offline. Its
    // provenance describes the successful capture, not a claim of currentness.
    try {
      const previous = readReference(path.join(harnessRoot, REFERENCE_PATH));
      if (previous.startsWith(generated("# Shared Chicago permit application reference"))) {
        return { document: previous, source: null };
      }
    } catch { /* A new workspace receives the bundled authorized snapshot. */ }
    content = readReference(BUNDLED_PATH);
  }
  const sourceHash = hash(content);
  const recorded = /Recorded\s+(\d{4}-\d{2}-\d{2})/i.exec(content)?.[1] || "Not stated; use the source hash as its version";
  const preamble = generated(`# Shared Chicago permit application reference

- Authorized source, relative to the configured STUDIO Dropbox root: \`${SOURCE_RELATIVE_PATH}\`
- Copy obtained from: ${sourcePath ? "the shared source file" : "the bundled authorized snapshot (shared source unavailable)"}
- Source recorded date: ${recorded}
- Source version (SHA-256): \`${sourceHash}\`

This is shared procedural guidance, not engagement facts or a compliance/stamping decision.
Read it before Chicago permit application advice, then verify the current official instructions
for the exact review program and portal. A copied date/hash is not proof of current City policy.
Use this local copy; its source attribution does not authorize access outside this engagement.
Repair/Refresh updates it; prior copies are retained in Mi's .mi-backups on replacement.
The source text below is preserved in full, including URLs, retrieval dates and corrections.`);
  return {
    document: `${preamble}\n---\n\n${content}`,
    source: sourcePath ? { path: sourcePath, hash: sourceHash } : null,
  };
}

function verifyGuidanceSource(source) {
  if (!source) return;
  try {
    if (hash(readReference(source.path)) === source.hash) return;
  } catch { /* Unavailable and changed sources both require a fresh preview. */ }
  throw new Error("Shared Chicago guidance changed or became unavailable. Preview the workspace again.");
}

module.exports = { SOURCE_RELATIVE_PATH, REFERENCE_PATH, loadPermitQaqcGuidance, verifyGuidanceSource, verifyGuidanceDestination };
