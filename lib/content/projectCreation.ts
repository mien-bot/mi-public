import fs from "node:fs";
import path from "node:path";
import { getProjectSlugs } from "@/lib/content";
import { createStudioProject } from "@/src/adapters/notion/studioProjects";
import type { ProjectStatus } from "@/lib/schema";
import { DROPBOX_ROOT, PROJECTS_DIR, REPO_ROOT } from "./paths";
import { renameDurably } from "./durableRename";
import type { ProjectCreationPlan } from "./projectCreationPlan";

/**
 * The shared mechanics behind every confirmed project creation: the durable request state,
 * the Dropbox preflight and write, and the Notion phase guard. Extracted from
 * app/api/projects/route.ts when lead conversion started creating real folders too --
 * a second hand-rolled copy of these writes is exactly how two paths drift into
 * "the New Project form is safe, converting a lead isn't".
 */

export type CreationPhase =
  | "prepared"
  | "dropbox-created"
  /** Lead conversion only: the lead's brief and file copies landed in the Dropbox folder. */
  | "lead-data-copied"
  | "notion-pending-review"
  | "notion-created"
  /** Lead conversion only: projects/<slug>/ exists, but the lead is not linked to it yet. */
  | "scaffolded"
  | "complete";

export interface CreationState<TPlan = ProjectCreationPlan> {
  requestId: string;
  plan: TPlan;
  phase: CreationPhase;
  createdFolders: string[];
  notion?: { id: string; url: string };
  error?: string;
}

export class ProjectCreationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function statePath(requestId: string): string {
  if (!/^[a-f0-9-]{16,64}$/i.test(requestId)) {
    throw new ProjectCreationError("A stable project-creation request id is required.", 400);
  }
  return path.join(REPO_ROOT, ".mi", "project-creation", `${requestId}.json`);
}

export function readCreationState<TPlan>(requestId: string): CreationState<TPlan> | null {
  const filePath = statePath(requestId);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as CreationState<TPlan>;
}

export function writeCreationState<TPlan>(state: CreationState<TPlan>): void {
  const filePath = statePath(state.requestId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  renameDurably(temporary, filePath);
}

/** Resolves a DROPBOX_ROOT-relative path to a real absolute target, or explains what to fix. */
export function resolveDropboxTarget(relativePath: string): string {
  if (!DROPBOX_ROOT) throw new ProjectCreationError("Choose the local Dropbox root in Settings first.", 409);
  // Without this the realpath below fails with a raw ENOENT that names no setting, which is
  // what a person actually sees when their Dropbox folder was renamed or moved after setup.
  if (!fs.existsSync(DROPBOX_ROOT)) {
    throw new ProjectCreationError(
      `The configured Dropbox root no longer exists: ${DROPBOX_ROOT}. Choose its current location in Settings.`,
      409,
    );
  }
  const realRoot = fs.realpathSync(DROPBOX_ROOT);
  const target = path.resolve(realRoot, relativePath);
  const relative = path.relative(realRoot, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ProjectCreationError("Dropbox folder escapes the configured root.", 400);
  }
  const projectsRoot = path.join(realRoot, "1.00 PROJECTS");
  if (fs.existsSync(projectsRoot)) {
    const realProjectsRoot = fs.realpathSync(projectsRoot);
    const relativeToRoot = path.relative(realRoot, realProjectsRoot);
    if (relativeToRoot === ".." || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
      throw new ProjectCreationError("The Dropbox projects folder resolves outside the configured root.", 409);
    }
  }
  return target;
}

export function assertProjectSlugAvailable(slug: string, localPath: string): void {
  if (getProjectSlugs().includes(slug) || fs.existsSync(path.join(PROJECTS_DIR, slug))) {
    throw new ProjectCreationError(`${localPath} already exists.`, 409);
  }
}

export function preflightDropbox(
  dropbox: ProjectCreationPlan["dropbox"],
  allowExistingDropbox: boolean,
): string {
  const target = resolveDropboxTarget(dropbox.relativePath);
  if (dropbox.mode === "link-existing") {
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      throw new ProjectCreationError(
        `The selected Dropbox folder does not exist: ${dropbox.relativePath}. Choose it again.`,
        409,
      );
    }
    const realRoot = fs.realpathSync(DROPBOX_ROOT!);
    const realTarget = fs.realpathSync(target);
    const relative = path.relative(realRoot, realTarget);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new ProjectCreationError("The selected Dropbox folder resolves outside the configured root.", 409);
    }
  } else if (!allowExistingDropbox && fs.existsSync(target)) {
    throw new ProjectCreationError(
      `Dropbox folder already exists: ${dropbox.relativePath}. Choose a unique folder or link it from the existing project workflow.`,
      409,
    );
  }
  return target;
}

export function preflightProjectCreation(plan: ProjectCreationPlan, allowExistingDropbox: boolean): string {
  assertProjectSlugAvailable(plan.project.slug, plan.mi.localPath);
  return preflightDropbox(plan.dropbox, allowExistingDropbox);
}

/** Creates only the reviewed folder list plus the root convention files. Never overwrites. */
export function createDropboxStructure<TPlan>(
  target: string,
  dropbox: ProjectCreationPlan["dropbox"],
  state: CreationState<TPlan>,
): void {
  // dropbox.agentWorkspace ("Mi") is always created alongside the profile's working
  // folders -- it starts empty; AGENTS.md/CLAUDE.md content generates the first time the
  // existing Agent Workspace refresh action (Files & Contracts page) runs for this project.
  const entries = ["", dropbox.agentWorkspace, ...dropbox.folders];
  for (const relativePath of entries) {
    const folder = relativePath ? path.join(target, relativePath) : target;
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const label = relativePath || ".";
    if (!state.createdFolders.includes(label)) state.createdFolders.push(label);
    writeCreationState(state);
  }
  // Written once at the project root; never overwritten on retry so a human edit survives
  // a stale-state re-run (see the "notion-pending-review" retry path in the routes).
  for (const file of dropbox.files) {
    const filePath = path.join(target, file.relativePath);
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, file.content, "utf8");
  }
  state.phase = "dropbox-created";
  writeCreationState(state);
}

/**
 * Creates the Studio Projects page exactly once per request id. A failure here is never
 * auto-retried: the page may well exist, so the state parks at notion-pending-review and
 * the caller has to review Notion before trying again.
 */
export async function createNotionProjectPage<TPlan>(
  state: CreationState<TPlan>,
  input: {
    name: string;
    status: ProjectStatus;
    client?: string;
    location?: string;
    projectTypes?: string[];
    scopes?: string[];
  },
): Promise<{ id: string; url: string }> {
  if (state.notion) return state.notion;
  state.phase = "notion-pending-review";
  writeCreationState(state);
  try {
    state.notion = await createStudioProject(input);
  } catch (cause) {
    state.error = cause instanceof Error ? cause.message : "Notion project creation failed.";
    writeCreationState(state);
    throw new ProjectCreationError(
      "Dropbox folders were created, but the Notion result is uncertain. Review Studio Projects before retrying.",
      502,
    );
  }
  state.phase = "notion-created";
  state.error = undefined;
  writeCreationState(state);
  return state.notion;
}
