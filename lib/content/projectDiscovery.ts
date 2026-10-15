import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getProject, getProjectSlugs, contentDir } from "./projects";
import { DROPBOX_ROOT } from "./paths";
import { resolveDropboxRelativePath } from "./dropboxPaths";
import { hashContent } from "./atomicContentWrite";
import type { ProjectDiscovery, ProjectFile, ProjectHandoff } from "./projectDiscoveryTypes";
import { handoffSchema } from "./projectHandoffSchema";

const DOCUMENTS = /\.(pdf|docx?|xlsx?|pptx?|rtf|txt|csv|dwg|dxf|rvt|ifc|jpg|jpeg|png|webp|tiff?)$/i;
const RECORDS = /\.(md|ya?ml)$/i;
const EXCLUDED = /^(\.|node_modules$|tools$|scratchpad$|inbox$|credentials?$|secrets?$)/i;
const PRIVATE_FILE = /(^|[-_.])(credentials?|secrets?|tokens?)([-_.]|$)/i;
const cache = new Map<string, { at: number; mapping: string; value: Promise<ProjectDiscovery> }>();
const fingerprints = new Map<string, { stamp: string; revision: string }>();

export function safeProjectPath(value: string): string {
  const segments = value.split("/");
  if (!value || value.length > 600 || segments.some(s => !s || s === "." || s === ".." || /[\\:\x00-\x1f<>"|?*]/.test(s) || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s) || EXCLUDED.test(s) || PRIVATE_FILE.test(s))) {
    throw new Error("Choose a project-relative document path without private or hidden folders.");
  }
  return value;
}

/** Checks every existing ancestor, including Windows junctions, before reads or writes. */
export function guardedPath(root: string, relative: string): string {
  safeProjectPath(relative);
  const realRoot = fs.realpathSync.native(root);
  let current = realRoot;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Linked folders are not supported here.");
      const real = fs.realpathSync.native(current);
      const rel = path.relative(realRoot, real);
      if (path.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${path.sep}`)) throw new Error("Path leaves the project folder.");
    }
  }
  return current;
}

export function projectDiscoveryRoots(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || !getProjectSlugs().includes(slug)) throw new Error("Project not found.");
  const project = getProject(slug);
  let sharedRoot: string | null = null;
  if (project.meta.dropbox_path) {
    if (!DROPBOX_ROOT) throw new Error("The confirmed Dropbox folder is unavailable on this computer. Check Settings > Connections.");
    sharedRoot = resolveDropboxRelativePath(DROPBOX_ROOT, project.meta.dropbox_path);
    // Guard the confirmed mapping as well as its descendants.
    sharedRoot = guardedPath(DROPBOX_ROOT, path.relative(DROPBOX_ROOT, sharedRoot).split(path.sep).join("/"));
    if (!fs.existsSync(sharedRoot) || !fs.statSync(sharedRoot).isDirectory()) throw new Error("The confirmed Dropbox folder is unavailable. Check that it is synced locally.");
  }
  const localRoot = contentDir(slug);
  if (project.meta.content_location === "dropbox" && sharedRoot) guardedPath(sharedRoot, "Mi/project");
  else if (fs.lstatSync(localRoot).isSymbolicLink()) throw new Error("Linked project content folders are not supported here.");
  return { project, sharedRoot, localRoot, workRoot: sharedRoot ?? localRoot,
    prefix: sharedRoot ? "Mi/" : "",
    destination: sharedRoot ? `${project.meta.dropbox_path}/Mi` : `projects/${slug}` };
}

export function projectFileHref(slug: string, source: string, relative: string): string {
  return `/api/projects/${encodeURIComponent(slug)}/files?source=${source}&path=${encodeURIComponent(relative)}`;
}

export function invalidateProjectDiscovery(slug: string) { cache.delete(slug); }

export async function readProjectDiscovery(slug: string, refresh = false): Promise<ProjectDiscovery> {
  const roots = projectDiscoveryRoots(slug);
  const mapping = JSON.stringify([roots.localRoot, roots.sharedRoot, roots.project.meta]);
  const existing = cache.get(slug);
  if (!refresh && existing?.mapping === mapping && Date.now() - existing.at < 30_000) return existing.value;
  const value = scanProject(slug);
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  cache.set(slug, { at: Date.now(), mapping, value });
  try { return await value; } catch (error) { cache.delete(slug); throw error; }
}

/** Filename lookup never reads PDF bytes or alters revision caches/read status. */
export async function readProjectPdfIndex(slug: string) {
  const result = await scanProject(slug, true);
  return { slug, files: result.files, warnings: result.warnings, complete: result.complete, scannedAt: result.scannedAt };
}

async function scanProject(slug: string, pdfOnly = false): Promise<ProjectDiscovery> {
  const roots = projectDiscoveryRoots(slug);
  const result: ProjectDiscovery = { slug, projectName: roots.project.meta.name, files: [], handoffs: [], changes: [],
    scannedAt: new Date().toISOString(), complete: true, warnings: [], shared: Boolean(roots.sharedRoot), destination: roots.destination };
  let visited = 0, bytes = 0;
  const warn = (message: string) => { result.complete = false; if (!result.warnings.includes(message)) result.warnings.push(message); };
  async function walk(root: string, relative: string, source: "dropbox" | "local", depth: number, records: boolean) {
    if (depth > 8 || visited >= 4000 || result.files.length >= 1000) { warn("Scan limit reached. Some files are not listed; use Dropbox files to browse further."); return; }
    let entries;
    try { entries = await fs.promises.readdir(relative ? guardedPath(root, relative) : root, { withFileTypes: true }); }
    catch { warn("A folder could not be read. Check local file availability and refresh."); return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (++visited > 4000 || result.files.length >= 1000) { warn("Scan limit reached. Some files are not listed; use Dropbox files to browse further."); break; }
      if (EXCLUDED.test(entry.name) || PRIVATE_FILE.test(entry.name) || entry.isSymbolicLink()) continue;
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      if (records && relativePath === "project.yaml") continue; // Dedicated metadata revision below.
      // Shared structured records are scanned once through the content root below.
      if (source === "dropbox" && relativePath.toLowerCase() === "mi/project") continue;
      if (entry.isDirectory()) { await walk(root, relativePath, source, depth + 1, records); continue; }
      if (pdfOnly && !/\.pdf$/i.test(entry.name)) continue;
      const document = DOCUMENTS.test(entry.name);
      const handoff = relativePath.startsWith(`${source === "dropbox" ? "Mi/" : ""}handoffs/`) && entry.name.endsWith(".json");
      if (!document && !handoff && !(records && RECORDS.test(entry.name))) continue;
      try {
        const target = guardedPath(root, relativePath);
        const stat = await fs.promises.stat(target);
        if (!stat.isFile()) continue;
        const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
        const previous = pdfOnly ? undefined : fingerprints.get(target);
        const cached = !handoff && previous?.stamp === stamp ? previous.revision : null;
        let data: Buffer | undefined;
        if (!pdfOnly && !cached && stat.size <= 32 * 1024 * 1024 && bytes + stat.size <= 128 * 1024 * 1024) { data = await fs.promises.readFile(target); bytes += data.length; }
        const revision = cached ?? (data ? hashContent(data) : `metadata:${stat.size}:${stat.mtimeMs}`);
        if (!pdfOnly && revision.startsWith("metadata:")) warn("Some large files are listed without content fingerprints. Their change detection uses size and modification time.");
        // Retain metadata fallbacks too: fluctuating scan budgets must not turn an
        // unchanged file from a metadata revision into a hash and announce a false update.
        if (!pdfOnly && !cached) {
          if (fingerprints.size >= 10000) fingerprints.delete(fingerprints.keys().next().value!);
          fingerprints.set(target, { stamp, revision });
        }
        const id = `${source}:${relativePath}`;
        if (handoff) {
          if (!data || data.length > 100_000) { warn("An oversized handoff was skipped."); continue; }
          const parsed = handoffSchema.safeParse(JSON.parse(data.toString("utf8").replace(/^\uFEFF/, "")));
          if (!parsed.success) { warn("An invalid handoff was skipped. Review the original file."); continue; }
          result.handoffs.push(parsed.data as ProjectHandoff);
          result.changes.push({ id, revision, label: parsed.data.title, kind: "handoff", href: `/projects/${slug}/activity#${parsed.data.id}` });
        } else if (document) {
          const sharedContent = source === "local" && roots.project.meta.content_location === "dropbox";
          const fileSource = sharedContent ? "dropbox" : source;
          const filePath = sharedContent ? `Mi/project/${relativePath}` : relativePath;
          const file: ProjectFile = { id: `${fileSource}:${filePath}`, source: fileSource, path: filePath, name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString(), revision,
            output: /(^|\/)outputs\//i.test(relativePath), href: projectFileHref(slug, fileSource, filePath) };
          result.files.push(file);
          result.changes.push({ id: file.id, revision, label: filePath, kind: "file", href: file.href });
        } else {
          const section = relativePath.split("/")[0];
          const routes: Record<string, string> = { memory: "knowledge", schedule: "schedule", meetings: "meetings", decisions: "decisions", "site-reports": "site-reports", budget: "budget", details: "details" };
          result.changes.push({ id, revision, label: relativePath, kind: "record", href: `/projects/${slug}/${routes[section] ?? "knowledge"}` });
        }
      } catch { warn("A file could not be read or changed during the scan. Refresh after Dropbox finishes syncing."); }
    }
  }
  if (roots.sharedRoot) await walk(roots.sharedRoot, "", "dropbox", 0, false);
  await walk(roots.localRoot, "", "local", 0, true);
  result.files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.path.localeCompare(b.path));
  result.handoffs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Stable metadata revision covers scaffold changes even with shared content.
  result.changes.push({ id: "project:metadata", revision: crypto.createHash("sha256").update(JSON.stringify(roots.project.meta)).digest("hex"), label: "Project details", kind: "record", href: `/projects/${slug}/details` });
  return result;
}
