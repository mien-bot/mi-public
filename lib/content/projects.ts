import fs from "node:fs";
import path from "node:path";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import {
  budgetSchema,
  checklistSchema,
  drawingIndexSchema,
  libraryIndexSchema,
  markupIndexSchema,
  mepFaqFrontmatterSchema,
  permitStatusSchema,
  progressLogFrontmatterSchema,
  projectMetaSchema,
  reviewFrontmatterSchema,
  scheduleSchema,
  type Budget,
  type Checklist,
  type DrawingSetEntry,
  type LibraryDocument,
  type MarkupEntry,
  type PermitEntry,
  type ProgressLogFrontmatter,
  type ProjectMeta,
  type ReviewFrontmatter,
  type Schedule,
} from "@/lib/schema";
import { listDirs, listFiles, readMarkdownFile, readYamlFileIfExists, type MarkdownDoc } from "./fsUtils";
import { DROPBOX_ROOT, PROJECTS_DIR } from "./paths";
import { resolveProjectContentRoot, ContentRootUnavailableError } from "./projectContentRoot";
import { hashContent, readCurrentHash, writeFileAtomically, type AtomicWriteOptions } from "./atomicContentWrite";
import { scanForConflicts, type ConflictedFile } from "./dropboxConflicts";
import { deleteDirectoryRecoverably } from "./leadLibraryAtomicWrite";

export interface Project {
  slug: string;
  meta: ProjectMeta;
}

export function getProjectSlugs(): string[] {
  return listDirs(PROJECTS_DIR).filter((slug) =>
    fs.existsSync(path.join(PROJECTS_DIR, slug, "project.yaml")),
  );
}

/**
 * project.yaml itself always stays in the per-user local root -- it (and dropbox_path/
 * notion_page_id) is a per-machine, Notion-derived scaffold, not synced content. Only the
 * content *underneath* a project (schedule, details, meetings, etc.) can live in Dropbox;
 * see `contentDir` below.
 */
export function getProject(slug: string): Project {
  const filePath = path.join(PROJECTS_DIR, slug, "project.yaml");
  const raw = fs.readFileSync(filePath, "utf-8");
  const meta = projectMetaSchema.parse(loadYaml(raw));
  return { slug, meta };
}

/** Reads project metadata and its compare-before-write hash from the same byte snapshot. */
/**
 * Removes Mi's record of a project.
 *
 * Deliberately narrow: this deletes `projects/<slug>/` — Mi's own folder, holding
 * project.yaml and whatever local records live beside it — and **never** touches the
 * project's Dropbox content folder, even when `content_location` is "dropbox". Drawings,
 * submittals and the rest of the real project archive are not Mi's to destroy, and
 * AGENTS.md is explicit that Dropbox is not mutated without exact assignment authority.
 * The returned `dropboxContentLeftInPlace` flag is what lets the UI say so plainly rather
 * than letting someone assume the whole project is gone.
 *
 * Because this removes a whole folder rather than one record, it asks for the project's
 * exact name back first — the same discipline deleteLead uses, and for the same reason: a
 * slug is easy to mis-click out of a list, a typed name is not. The folder is copied into
 * `.mi-backups/` before removal, so even a confirmed mistake is recoverable from disk.
 *
 * The Notion page, if one is linked, is also left alone. Unlinking or archiving it is a
 * separate, human-confirmed action.
 */
export function deleteProject(
  slug: string,
  confirmation: { confirmed?: unknown; expectedName?: unknown },
): {
  slug: string;
  meta: ProjectMeta;
  backupPath: string;
  dropboxContentLeftInPlace: boolean;
  notionPageLeftInPlace: boolean;
} {
  if (confirmation.confirmed !== true) {
    throw new Error("Project deletion requires explicit confirmation.");
  }
  const dir = path.join(PROJECTS_DIR, slug);
  if (!fs.existsSync(path.join(dir, "project.yaml"))) {
    throw new Error(`Project "${slug}" was not found.`);
  }
  const { meta } = getProject(slug);
  if (confirmation.expectedName !== meta.name) {
    throw new Error("Project name changed. Refresh and confirm deletion again.");
  }

  const { backupPath } = deleteDirectoryRecoverably(dir, path.join(PROJECTS_DIR, ".mi-backups"));
  return {
    slug,
    meta,
    backupPath,
    dropboxContentLeftInPlace: meta.content_location === "dropbox",
    notionPageLeftInPlace: Boolean(meta.notion_page_id),
  };
}

export function getProjectWithHash(slug: string): { project: Project; hash: string } {
  const filePath = path.join(PROJECTS_DIR, slug, "project.yaml");
  const raw = fs.readFileSync(filePath);
  return {
    project: { slug, meta: projectMetaSchema.parse(loadYaml(raw.toString("utf8"))) },
    hash: hashContent(raw),
  };
}

export function getAllProjects(): Project[] {
  return getProjectSlugs().map(getProject);
}

/**
 * Writes the full, already-merged-and-parsed project.yaml -- same
 * schema-parse-then-atomic-write shape as writeProjectDetails in
 * projectWorkspace.ts, but targeting project.yaml itself (always the
 * per-user local root, per getProject's comment above -- never contentDir,
 * which can be Dropbox-shared). Callers (e.g. the copilot route's
 * "project-meta" branch) are responsible for merging onto the current
 * getProject(slug).meta before calling this, exactly like the
 * project-details branch does for writeProjectDetails.
 */
export function writeProjectMeta(slug: string, meta: ProjectMeta, options: AtomicWriteOptions = {}): void {
  const parsed = projectMetaSchema.parse(meta);
  const filePath = path.join(PROJECTS_DIR, slug, "project.yaml");
  writeFileAtomically(filePath, dumpYaml(parsed, { lineWidth: 100, noRefs: true }), options);
}

/** Resolves where this project's own content actually lives -- local or Dropbox-shared. */
export function contentDir(slug: string): string {
  return resolveProjectContentRoot(getProject(slug).meta, slug, DROPBOX_ROOT).dir;
}

/**
 * Scans this project's content root for Dropbox conflicted-copy files (see
 * components/DataConflictBanner.tsx for where this surfaces). Returns [] rather than
 * throwing when the content root is temporarily unreachable -- that's a separate,
 * already-visible failure mode for the page itself, not something this banner should
 * duplicate.
 */
export function detectProjectConflicts(slug: string): ConflictedFile[] {
  try {
    return scanForConflicts(contentDir(slug));
  } catch (error) {
    if (error instanceof ContentRootUnavailableError) return [];
    throw error;
  }
}

export function getProgressLog(slug: string): MarkdownDoc<ProgressLogFrontmatter>[] {
  const dir = path.join(contentDir(slug), "progress-log");
  return listFiles(dir, ".md")
    .map((file) =>
      readMarkdownFile(path.join(dir, file), (data) => progressLogFrontmatterSchema.parse(data)),
    )
    .sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date));
}

export function getReviews(slug: string): MarkdownDoc<ReviewFrontmatter>[] {
  const dir = path.join(contentDir(slug), "reviews");
  return listFiles(dir, ".md")
    .map((file) => readMarkdownFile(path.join(dir, file), (data) => reviewFrontmatterSchema.parse(data)))
    .sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date));
}

export function getMarkupIndex(slug: string): MarkupEntry[] {
  const filePath = path.join(contentDir(slug), "markups", "index.yaml");
  return readYamlFileIfExists(filePath, (data) => markupIndexSchema.parse(data), []);
}

const MEP_DISCIPLINES = ["mechanical", "electrical", "plumbing"] as const;

export function getMepNotes(slug: string) {
  const dir = path.join(contentDir(slug), "mep");
  return MEP_DISCIPLINES.map((discipline) => {
    const filePath = path.join(dir, `${discipline}.md`);
    if (!fs.existsSync(filePath)) return null;
    return readMarkdownFile(filePath, (data) => mepFaqFrontmatterSchema.partial().parse(data ?? {}));
  }).filter((doc): doc is NonNullable<typeof doc> => doc !== null);
}

export function getPermits(slug: string): PermitEntry[] {
  const filePath = path.join(contentDir(slug), "permits", "status.yaml");
  return readYamlFileIfExists(filePath, (data) => permitStatusSchema.parse(data), []);
}

export function schedulePath(slug: string): string {
  return path.join(contentDir(slug), "schedule", "schedule.yaml");
}

/** Active deadlines by default. Read-modify-write callers must include archived records. */
export function getSchedule(slug: string, options: { includeArchived?: boolean } = {}): Schedule {
  const schedule = readYamlFileIfExists(schedulePath(slug), (data) => scheduleSchema.parse(data), { milestones: [] });
  return options.includeArchived ? schedule : { milestones: schedule.milestones.filter((item) => !item.archived_at) };
}

/** Same as getSchedule, plus the file's current hash -- see getProjectDetailsWithHash for why. */
export function getScheduleWithHash(slug: string): { schedule: Schedule; hash: string | null } {
  return { schedule: getSchedule(slug), hash: readCurrentHash(schedulePath(slug)) };
}

export function getBudget(slug: string): Budget {
  const filePath = path.join(contentDir(slug), "budget", "budget.yaml");
  return readYamlFileIfExists(filePath, (data) => budgetSchema.parse(data), { categories: [] });
}

export function getLessonsLearned(slug: string) {
  const filePath = path.join(contentDir(slug), "lessons-learned", "lessons.md");
  if (!fs.existsSync(filePath)) return null;
  return readMarkdownFile(filePath, (data) => data as Record<string, unknown>);
}

export interface ProjectLessons {
  projectSlug: string;
  projectName: string;
  doc: NonNullable<ReturnType<typeof getLessonsLearned>>;
}

/**
 * Cross-project view used by the /lessons-learned search page. A single project whose
 * Dropbox-shared content is temporarily unreachable is skipped rather than failing the
 * whole portfolio-wide list -- see ContentRootUnavailableError.
 */
export function getAllLessonsLearned(): ProjectLessons[] {
  return getAllProjects()
    .flatMap((project) => {
      try {
        const doc = getLessonsLearned(project.slug);
        return doc ? [{ projectSlug: project.slug, projectName: project.meta.name, doc }] : [];
      } catch (error) {
        if (error instanceof ContentRootUnavailableError) return [];
        throw error;
      }
    });
}

export function getDrawingIndex(slug: string): DrawingSetEntry[] {
  const filePath = path.join(contentDir(slug), "drawings", "index.yaml");
  return readYamlFileIfExists(filePath, (data) => drawingIndexSchema.parse(data), []);
}

export function getChecklist(slug: string): Checklist | null {
  const filePath = path.join(contentDir(slug), "checklists", "code-compliance.yaml");
  if (!fs.existsSync(filePath)) return null;
  return readYamlFileIfExists(filePath, (data) => checklistSchema.parse(data), {
    checklist_id: "code-compliance-v1",
    items: [],
  });
}

export function getQaqcChecklist(slug: string): Checklist | null {
  const filePath = path.join(contentDir(slug), "qaqc", "qaqc.yaml");
  if (!fs.existsSync(filePath)) return null;
  return readYamlFileIfExists(filePath, (data) => checklistSchema.parse(data), {
    checklist_id: "qaqc-v1",
    items: [],
  });
}

/**
 * Raw-file-drop folders (submissions/inspiration/contracts) — same
 * "just drop a file, run index-project-folder" pattern as library/<collection>/.
 * Tag an entry "archived" in its `tags` list to mark it superseded; nothing
 * deletes automatically.
 */
export const PROJECT_DOCUMENT_FOLDERS = ["submissions", "inspiration", "contracts"] as const;
export type ProjectDocumentFolder = (typeof PROJECT_DOCUMENT_FOLDERS)[number];

export function getProjectDocuments(slug: string, folder: ProjectDocumentFolder): LibraryDocument[] {
  const filePath = path.join(contentDir(slug), folder, "index.yaml");
  return readYamlFileIfExists(filePath, (data) => libraryIndexSchema.parse(data ?? []), []);
}

export function getProjectQuestions(slug: string) {
  const filePath = path.join(contentDir(slug), "questions", "questions.md");
  if (!fs.existsSync(filePath)) return null;
  return readMarkdownFile(filePath, (data) => data as Record<string, unknown>);
}

export interface ProjectLink {
  label: string;
  url: string;
}

export function getProjectLinks(slug: string): ProjectLink[] {
  const filePath = path.join(contentDir(slug), "references", "links.md");
  if (!fs.existsSync(filePath)) return [];
  const links: ProjectLink[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const markdown = line.match(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/i);
    const plain = markdown ? null : line.match(/https?:\/\/\S+/i);
    const url = markdown?.[2] ?? plain?.[0]?.replace(/[.,;:]$/, "");
    if (!url || links.some((entry) => entry.url === url)) continue;
    links.push({ label: markdown?.[1] ?? new URL(url).hostname, url });
  }
  return links;
}
