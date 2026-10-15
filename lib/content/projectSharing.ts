import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hashContent } from "./atomicContentWrite";
import { retryWhileLocked } from "./durableRename";
import { guardedPath, invalidateProjectDiscovery, projectDiscoveryRoots, projectFileHref, safeProjectPath } from "./projectDiscovery";
import { handoffDraftSchema } from "./projectHandoffSchema";

function writeNewFile(target: string, bytes: Buffer) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: "wx" });
    // An exclusive copy prevents an existing partner file being overwritten, even if it
    // arrived after the preview. Dropbox/Defender may still hold the temporary file open.
    retryWhileLocked(() => fs.copyFileSync(temporary, target, fs.constants.COPYFILE_EXCL));
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* An owned temporary file may remain locked. */ }
  }
}

export function previewProjectPdf(slug: string, name: string, bytes: Buffer) {
  if (bytes.length > 20 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Choose a valid PDF smaller than 20 MB.");
  if (!/^[^/\\]+\.pdf$/i.test(name)) throw new Error("Use a PDF filename without folders.");
  safeProjectPath(name);
  const roots = projectDiscoveryRoots(slug);
  const relative = `${roots.prefix}outputs/${name}`;
  const target = guardedPath(roots.workRoot, relative);
  const revision = hashContent(bytes);
  const exists = fs.existsSync(target);
  if (exists && hashContent(fs.readFileSync(target)) !== revision) throw new Error("A different file already has this name. Choose a new filename; existing files are never overwritten.");
  return { destination: `${roots.destination}/outputs/${name}`, shared: Boolean(roots.sharedRoot), alreadySaved: exists,
    fingerprint: hashContent(JSON.stringify({ slug, root: roots.workRoot, relative, revision })),
    href: projectFileHref(slug, roots.sharedRoot ? "dropbox" : "local", relative) };
}

export function saveProjectPdf(slug: string, name: string, bytes: Buffer, fingerprint: string, confirmed: boolean) {
  const preview = previewProjectPdf(slug, name, bytes);
  if (!confirmed || preview.fingerprint !== fingerprint) throw new Error("The reviewed file or destination changed. Preview and confirm again.");
  if (!preview.alreadySaved) {
    const roots = projectDiscoveryRoots(slug);
    writeNewFile(guardedPath(roots.workRoot, `${roots.prefix}outputs/${name}`), bytes);
  }
  invalidateProjectDiscovery(slug);
  return preview;
}

export function previewProjectHandoff(slug: string, input: unknown) {
  const draft = handoffDraftSchema.parse(input);
  const roots = projectDiscoveryRoots(slug);
  for (const file of draft.files) {
    if (roots.sharedRoot && file.source !== "dropbox") throw new Error("Save local files to the shared project first, then attach their shared references.");
    const root = file.source === "dropbox" ? roots.sharedRoot : roots.localRoot;
    if (!root) throw new Error("The referenced file is not available.");
    const target = guardedPath(root, file.path);
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error("Attach available files up to 32 MB.");
    if (hashContent(fs.readFileSync(target)) !== file.revision) throw new Error("An attached file changed. Refresh the file list and review again.");
  }
  const destination = `${roots.destination}/handoffs/${draft.id}.json`;
  return { draft, destination, shared: Boolean(roots.sharedRoot), fingerprint: hashContent(JSON.stringify({ slug, root: roots.workRoot, destination, draft })) };
}

export function saveProjectHandoff(slug: string, input: unknown, fingerprint: string, confirmed: boolean) {
  const preview = previewProjectHandoff(slug, input);
  if (!confirmed || fingerprint !== preview.fingerprint) throw new Error("The handoff or destination changed. Preview and confirm again.");
  const roots = projectDiscoveryRoots(slug);
  const target = guardedPath(roots.workRoot, `${roots.prefix}handoffs/${preview.draft.id}.json`);
  if (fs.existsSync(target)) {
    const existing = JSON.parse(fs.readFileSync(target, "utf8"));
    if (JSON.stringify(handoffDraftSchema.strip().parse(existing)) !== JSON.stringify(preview.draft)) throw new Error("This handoff ID is already used. Start a new handoff.");
    return existing;
  }
  const handoff = { ...preview.draft, version: 1, createdAt: new Date().toISOString() };
  writeNewFile(target, Buffer.from(`${JSON.stringify(handoff, null, 2)}\n`));
  invalidateProjectDiscovery(slug);
  return handoff;
}
