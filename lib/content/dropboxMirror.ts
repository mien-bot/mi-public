import fs from "node:fs";
import path from "node:path";
import { getProject } from "./projects";
import { DROPBOX_ROOT, PROJECTS_DIR } from "./paths";
import {
  hashContent,
  readCurrentHash,
  writeFileAtomically,
} from "./atomicContentWrite";
import { appendMemoryNoteFile } from "./projectWorkspace";

const MIRRORED_EXTENSIONS = new Set([".md", ".yaml", ".yml", ".json"]);
const GENERATED_MARKER = "<!-- mi-generated:harness-v1 -->";

export type DropboxMirrorAction = "create" | "update" | "identical" | "conflict";

export interface DropboxMirrorEntry {
  relativePath: string;
  action: DropboxMirrorAction;
  sourceHash: string;
  destinationHash: string | null;
}

export interface DropboxMirrorConflict {
  relativePath: string;
  sourceHash: string;
  destinationHash: string;
}

export interface DropboxMirrorResult {
  mirrored: boolean;
  destination?: string;
  fileCount?: number;
  entries?: DropboxMirrorEntry[];
  conflicts?: DropboxMirrorConflict[];
  reason?: "not-linked" | "missing-source" | "already-shared" | "conflict";
}

interface PlannedEntry extends DropboxMirrorEntry {
  content: string;
  target: string;
}

interface MirrorPlan {
  destination: string;
  entries: PlannedEntry[];
  conflicts: DropboxMirrorConflict[];
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

function isInsideOrSame(root: string, target: string): boolean {
  return path.resolve(root) === path.resolve(target) || isInside(root, target);
}

function existingRealDirectory(target: string, label: string): string {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error(`${label} must be an existing directory.`);
  }
  return fs.realpathSync.native(target);
}

export function resolveConfirmedProjectDir(dropboxRoot: string, dropboxPath: string): string {
  const resolvedRoot = existingRealDirectory(path.resolve(dropboxRoot), "DROPBOX_ROOT");
  const candidate = path.resolve(resolvedRoot, dropboxPath);
  if (!isInside(resolvedRoot, candidate)) {
    throw new Error(`dropbox_path escapes DROPBOX_ROOT: ${dropboxPath}`);
  }
  const projectDir = existingRealDirectory(candidate, "Confirmed Dropbox project folder");
  if (!isInside(resolvedRoot, projectDir)) {
    throw new Error(`dropbox_path escapes DROPBOX_ROOT: ${dropboxPath}`);
  }
  return projectDir;
}

function listKnowledgeFiles(projectDir: string): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(projectDir, absolute);
      if (relative.split(path.sep)[0] === "memory") continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && MIRRORED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(absolute);
      }
    }
  }
  walk(projectDir);
  return files.sort((left, right) => left.localeCompare(right));
}

function generated(content: string): string {
  return `${GENERATED_MARKER}\n${content.trim()}\n`;
}

/**
 * Builds the same marker-wrapped Mi/project snapshot as the desktop harness.
 * Existing user-authored files are conflicts, never overwrite candidates.
 */
export function planProjectKnowledgeMirror(projectDir: string, destination: string): MirrorPlan {
  const entries = listKnowledgeFiles(projectDir).map((source): PlannedEntry => {
    const relativePath = path.relative(projectDir, source).split(path.sep).join("/");
    const content = generated(fs.readFileSync(source, "utf8"));
    const target = path.resolve(destination, ...relativePath.split("/"));
    if (!isInside(destination, target)) {
      throw new Error(`Mirror target escapes the Dropbox Mi/project destination: ${relativePath}`);
    }
    const destinationHash = readCurrentHash(target);
    const sourceHash = hashContent(content);
    let action: DropboxMirrorAction;
    if (destinationHash === null) action = "create";
    else {
      const existing = fs.readFileSync(target, "utf8");
      if (destinationHash === sourceHash) action = "identical";
      else if (existing.startsWith(`${GENERATED_MARKER}\n`)) action = "update";
      else action = "conflict";
    }
    return { relativePath, action, sourceHash, destinationHash, content, target };
  });
  return {
    destination,
    entries,
    conflicts: entries
      .filter((entry) => entry.action === "conflict" && entry.destinationHash)
      .map((entry) => ({
        relativePath: entry.relativePath,
        sourceHash: entry.sourceHash,
        destinationHash: entry.destinationHash as string,
      })),
  };
}

interface DropboxMirrorContext {
  projectDir: string;
  projectDropboxDir: string;
  destination: string;
}

function resolveProjectDropboxDir(slug: string): string | DropboxMirrorResult {
  const project = getProject(slug);
  if (!DROPBOX_ROOT || !project.meta.dropbox_path) return { mirrored: false, reason: "not-linked" };
  return resolveConfirmedProjectDir(DROPBOX_ROOT, project.meta.dropbox_path);
}

function resolveMirrorContext(slug: string): DropboxMirrorContext | DropboxMirrorResult {
  const project = getProject(slug);
  if (!DROPBOX_ROOT || !project.meta.dropbox_path) return { mirrored: false, reason: "not-linked" };
  if (project.meta.content_location === "dropbox") return { mirrored: false, reason: "already-shared" };
  const resolvedDropbox = resolveConfirmedProjectDir(DROPBOX_ROOT, project.meta.dropbox_path);

  const projectDir = path.join(PROJECTS_DIR, slug);
  if (!fs.existsSync(projectDir)) return { mirrored: false, reason: "missing-source" };

  const destinationCandidate = path.join(resolvedDropbox, "Mi", "project");
  let destination = destinationCandidate;
  if (fs.existsSync(destinationCandidate)) {
    destination = existingRealDirectory(destinationCandidate, "Dropbox Mi/project destination");
    if (!isInside(resolvedDropbox, destination)) {
      throw new Error("Dropbox Mi/project destination escapes the confirmed project folder.");
    }
  }
  return { projectDir, projectDropboxDir: resolvedDropbox, destination };
}

function publicResult(plan: MirrorPlan): DropboxMirrorResult {
  const entries = plan.entries.map((entry): DropboxMirrorEntry => ({
    relativePath: entry.relativePath,
    action: entry.action,
    sourceHash: entry.sourceHash,
    destinationHash: entry.destinationHash,
  }));
  if (plan.conflicts.length > 0) {
    return {
      mirrored: false,
      reason: "conflict",
      destination: plan.destination,
      fileCount: plan.entries.length,
      entries,
      conflicts: plan.conflicts,
    };
  }
  return {
    mirrored: true,
    destination: plan.destination,
    fileCount: plan.entries.length,
    entries,
  };
}

/** Side-effect-free validation, hashes, and per-file actions for a prospective mirror. */
export function previewProjectKnowledgeMirror(slug: string): DropboxMirrorResult {
  const context = resolveMirrorContext(slug);
  if ("mirrored" in context) return context;
  return publicResult(planProjectKnowledgeMirror(context.projectDir, context.destination));
}

function validateWriteParent(destination: string, target: string, relativePath: string): void {
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const realParent = fs.realpathSync.native(parent);
  if (!isInsideOrSame(destination, realParent)) {
    throw new Error(`Mirror target escapes the Dropbox Mi/project destination: ${relativePath}`);
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`Mirror target is a symbolic link: ${relativePath}`);
  }
}

/** Safely refreshes only marker-owned files beneath <Dropbox project>/Mi/project/. */
export function mirrorProjectKnowledge(slug: string): DropboxMirrorResult {
  const context = resolveMirrorContext(slug);
  if ("mirrored" in context) return context;

  fs.mkdirSync(context.destination, { recursive: true });
  const destination = fs.realpathSync.native(context.destination);
  if (!isInside(context.projectDropboxDir, destination)) {
    throw new Error("Dropbox Mi/project destination escapes the confirmed project folder.");
  }

  const plan = planProjectKnowledgeMirror(context.projectDir, destination);
  if (plan.conflicts.length > 0) return publicResult(plan);
  for (const entry of plan.entries) {
    if (entry.action === "identical") continue;
    validateWriteParent(destination, entry.target, entry.relativePath);
    writeFileAtomically(entry.target, entry.content, { expectedHash: entry.destinationHash });
  }
  return publicResult(plan);
}

export interface DropboxMemoryPreview {
  available: boolean;
  destination?: string;
  currentHash?: string | null;
  reason?: "not-linked";
}

/** Resolves only the confirmed agent-authored memory file; never reads a guessed folder. */
export function previewDropboxProjectMemory(slug: string): DropboxMemoryPreview {
  const projectDropboxDir = resolveProjectDropboxDir(slug);
  if (typeof projectDropboxDir !== "string") return { available: false, reason: "not-linked" };
  const destination = path.join(projectDropboxDir, "Mi", "memory", "notes.md");
  if (!isInside(projectDropboxDir, destination)) {
    throw new Error("Dropbox agent memory destination escapes the confirmed project folder.");
  }
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) {
    throw new Error("Dropbox agent memory destination is a symbolic link.");
  }
  return { available: true, destination, currentHash: readCurrentHash(destination) };
}

/**
 * Appends one human-confirmed note to the agent-authored Dropbox memory.
 * It does not mirror or replace the local memory file, so divergent histories remain intact.
 */
export function appendDropboxProjectMemoryNote(
  slug: string,
  note: { title: string; entry: string },
  expectedHash?: string | null,
): string {
  const preview = previewDropboxProjectMemory(slug);
  if (!preview.available || !preview.destination) {
    throw new Error("The project is not linked to a confirmed Dropbox folder.");
  }
  return appendMemoryNoteFile(preview.destination, note, {
    expectedHash: expectedHash === undefined ? preview.currentHash : expectedHash,
  });
}
