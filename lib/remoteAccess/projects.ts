import fs from "node:fs";
import { getProject, getProjectSlugs, getSchedule } from "@/lib/content/projects";
import { getProjectDetails } from "@/lib/content/projectWorkspace";
import { guardedPath, projectDiscoveryRoots, readProjectPdfIndex } from "@/lib/content/projectDiscovery";
import { handoffSchema } from "@/lib/content/projectHandoffSchema";
import { projectGrants, requireProjectGrant, RemoteReadError } from "./access";
import type { RemotePrincipal } from "./cloudflare";

export function remoteProjects(principal: RemotePrincipal) {
  const available = new Set(getProjectSlugs());
  return projectGrants(principal.email).filter(slug => available.has(slug)).flatMap(slug => {
    try {
      const { meta } = getProject(slug);
      // The pilot exposes only projects with a human-confirmed shared-folder mapping.
      return meta.dropbox_path ? [{ slug, name: meta.name, status: meta.status }] : [];
    } catch { return []; }
  });
}

function checkedRoots(principal: RemotePrincipal, slug: string) {
  requireProjectGrant(principal, slug); // before any existence or file lookup
  const roots = projectDiscoveryRoots(slug);
  if (!roots.sharedRoot) throw new RemoteReadError(404);
  return roots;
}

export async function remoteProject(principal: RemotePrincipal, slug: string) {
  const roots = checkedRoots(principal, slug);
  const warnings: string[] = [];
  const index = await readProjectPdfIndex(slug);
  warnings.push(...index.warnings);
  const files = index.files.filter(file => file.source === "dropbox").map(file => ({
    name: file.name, path: file.path, size: file.size, modifiedAt: file.modifiedAt,
    href: `/api/mobile/projects/${encodeURIComponent(slug)}/pdf?path=${encodeURIComponent(file.path)}`,
  }));
  const handoffs: Array<{ title: string; summary: string; nextSteps: string; openQuestions: string; createdAt: string }> = [];
  try {
    const folder = guardedPath(roots.sharedRoot!, "Mi/handoffs");
    if (fs.existsSync(folder)) {
      const entries = await fs.promises.readdir(folder, { withFileTypes: true });
      if (entries.length > 1000) warnings.push("Some handoffs are outside this bounded listing.");
      const recent = [];
      for (const entry of entries.slice(0, 1000)) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const file = guardedPath(roots.sharedRoot!, `Mi/handoffs/${entry.name}`);
        const stat = await fs.promises.stat(file);
        if (stat.size <= 100_000) recent.push({ file, modified: stat.mtimeMs });
      }
      for (const { file } of recent.sort((a, b) => b.modified - a.modified).slice(0, 20)) {
        const parsed = handoffSchema.safeParse(JSON.parse((await fs.promises.readFile(file, "utf8")).replace(/^\uFEFF/, "")));
        if (!parsed.success) { warnings.push("A shared handoff could not be read."); continue; }
        const { title, summary, nextSteps, openQuestions, createdAt } = parsed.data;
        handoffs.push({ title, summary, nextSteps, openQuestions, createdAt });
      }
    }
  } catch { warnings.push("Some shared handoffs are unavailable on the host."); }
  let scope = "";
  let milestones: Array<{ name: string; plannedDate: string | null }> = [];
  try {
    for (const name of ["details.yaml", "schedule/schedule.yaml"]) {
      const file = guardedPath(roots.localRoot, name);
      if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) throw Error();
    }
    scope = getProjectDetails(slug).scope.slice(0, 6000);
    milestones = getSchedule(slug).milestones.filter(item => !item.actual_date)
      .sort((a, b) => (a.planned_date || "9999").localeCompare(b.planned_date || "9999"))
      .slice(0, 5).map(item => ({ name: item.name, plannedDate: item.planned_date }));
  } catch { warnings.push("Some saved project details are unavailable on the host."); }
  return { slug, name: roots.project.meta.name, status: roots.project.meta.status, scope, milestones,
    files, handoffs, warnings: [...new Set(warnings)], scannedAt: index.scannedAt };
}

export async function remotePdf(principal: RemotePrincipal, slug: string, relative: string) {
  const roots = checkedRoots(principal, slug);
  if (!/\.pdf$/i.test(relative)) throw new RemoteReadError(404);
  let file;
  try { file = guardedPath(roots.sharedRoot!, relative); } catch { throw new RemoteReadError(404); }
  let handle;
  try {
    handle = await fs.promises.open(file, "r");
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new RemoteReadError(404, "PDF unavailable or larger than the 20 MB remote preview limit.");
    // Read through one handle with a hard cap, even if a sync writer grows the file.
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) throw new RemoteReadError(409, "PDF changed during reading. Refresh and retry.");
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new RemoteReadError(409);
    if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new RemoteReadError(404);
    return bytes;
  } catch (error) { if (error instanceof RemoteReadError) throw error; throw new RemoteReadError(404); }
  finally { await handle?.close(); }
}
