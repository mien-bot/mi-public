import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { meetingVisibilitySchema } from "@/lib/schema";
import { hashContent, readCurrentHash, writeFileAtomically } from "./atomicContentWrite";
import { resolveConfirmedProjectDir } from "./dropboxMirror";
import { getLead, leadDir } from "./leads";
import { getPermitQaqcEngagement, permitQaqcDir } from "./permitQaqc";
import { getProject } from "./projects";
import { DROPBOX_ROOT, PROJECTS_DIR } from "./paths";

const MAX_ENTRY_FILES = 500;
const MAX_ENTRY_FILE_BYTES = 500_000;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{2,79}$/;

export const workspaceKindSchema = z.enum(["lead", "project", "permit-qaqc"]);
export type WorkspaceKind = z.infer<typeof workspaceKindSchema>;

/**
 * What a terminal session learned, in the form Mi can route.
 *
 * `why` is a first-class field rather than part of `body` because it is the part that
 * reliably gets lost: a decision without its reasoning reads as arbitrary three weeks
 * later, and the person who has to reopen it cannot tell what it cost to settle.
 */
export const outboxEntryKindSchema = z.enum([
  "meeting",
  "decision",
  "action",
  "open-question",
  "risk",
  "fact",
  "record-change",
  "reference",
  "lesson",
]);
export type OutboxEntryKind = z.infer<typeof outboxEntryKindSchema>;

/** A workspace-relative path, a quoted excerpt, or both. Absolute paths are refused. */
export const outboxEvidenceSchema = z.object({
  path: z.string().trim().max(1_000).nullable().default(null),
  quote: z.string().trim().max(4_000).default(""),
}).refine(
  (evidence) => Boolean(evidence.path) || evidence.quote.length > 0,
  "Evidence needs a workspace-relative path, a quote, or both.",
).refine(
  (evidence) => !evidence.path || !(path.isAbsolute(evidence.path) || /^[A-Za-z]:[\\/]/.test(evidence.path)),
  "Evidence paths are relative to the workspace, never absolute.",
);

/**
 * The record field this entry would change. Advisory only -- naming a target never
 * applies anything, it just tells Mi which review card to build and on which page.
 */
export const outboxTargetSchema = z.object({
  record: z.string().trim().min(1).max(200),
  field: z.string().trim().min(1).max(200),
  proposed: z.string().trim().min(1).max(2_000),
  current: z.string().trim().max(2_000).default(""),
});

export const outboxMeetingActionSchema = z.object({
  description: z.string().trim().min(1).max(1_000),
  owner: z.string().trim().max(200).default(""),
  /** Free text rather than a date: an agent that heard "end of next week" must not invent a date. */
  due_date: z.string().trim().max(100).default(""),
});
export type OutboxMeetingAction = z.infer<typeof outboxMeetingActionSchema>;

/**
 * Structured meeting detail, when the writing agent has it.
 *
 * Optional on purpose. The published inbox contract is `title`/`body`/`why`, and entries
 * already on disk carry nothing else, so a meeting card has to read just as well when this
 * is absent -- `describeMeetingEntry` recovers the same fields from the body's headings.
 * Supplying it skips that inference; it never becomes a requirement.
 */
export const outboxMeetingSchema = z.object({
  date: z.string().trim().max(40).default(""),
  start_time: z.string().trim().max(20).default(""),
  end_time: z.string().trim().max(20).default(""),
  timezone: z.string().trim().max(100).default(""),
  attendees: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  summary: z.string().trim().max(20_000).default(""),
  decisions: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
  action_items: z.array(outboxMeetingActionSchema).max(100).default([]),
  open_questions: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
  risks: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
});
export type OutboxMeeting = z.infer<typeof outboxMeetingSchema>;

const entryBodyShape = {
  kind: outboxEntryKindSchema,
  /**
   * Offsets are accepted, not just `Z`. Agents stamp entries with the workspace's local
   * time ("2026-08-15T15:14:29.167-05:00"); rejecting that would have silently skipped
   * every entry a Chicago-time session wrote.
   */
  created_at: z.string().datetime({ offset: true }),
  session: z.object({
    id: z.string().trim().min(1).max(200),
    agent: z.string().trim().min(1).max(100),
  }),
  workspace: z.object({
    type: workspaceKindSchema,
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  }),
  visibility: meetingVisibilitySchema,
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
  why: z.string().trim().max(8_000).default(""),
  evidence: z.array(outboxEvidenceSchema).max(50).default([]),
  targets: z.array(outboxTargetSchema).max(20).default([]),
  needs_confirmation: z.boolean().default(true),
  meeting: outboxMeetingSchema.nullable().default(null),
};

export const workspaceOutboxEntrySchema = z.object({
  version: z.literal(1),
  id: z.string().regex(SAFE_ID),
  ...entryBodyShape,
});
export type WorkspaceOutboxEntry = z.infer<typeof workspaceOutboxEntrySchema>;

/** The same entry without the fields Mi derives, which is what an agent actually writes. */
export const workspaceOutboxEntryInputSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(SAFE_ID).optional(),
  ...entryBodyShape,
});

/**
 * Content-derived, deliberately excluding `created_at` and `session`.
 *
 * Analyze must be idempotent: running it twice over unchanged data has to produce the
 * same ids, or the second run files duplicate cards for facts already reviewed. Hashing
 * the timestamp -- as the older project inbox did -- guarantees the opposite. Two sessions
 * that independently learn the same thing also collapse to one card, which is correct.
 */
export function outboxEntryId(entry: Pick<WorkspaceOutboxEntry,
  "kind" | "workspace" | "title" | "body" | "why" | "targets">): string {
  const canonical = JSON.stringify({
    kind: entry.kind,
    workspace: entry.workspace,
    title: entry.title.trim(),
    body: entry.body.trim(),
    why: entry.why.trim(),
    targets: entry.targets,
  });
  return `entry-${hashContent(canonical).slice(0, 24)}`;
}

export interface ResolvedWorkspace {
  /** The record's own folder in Mi's data root. Mi-owned state lives here. */
  recordDir: string;
  /** The folder agents work in: the confirmed Dropbox folder when linked. */
  workspaceRoot: string;
  /** <workspaceRoot>/Mi -- the generated agent workspace. */
  harnessRoot: string;
  dropboxPath: string | null;
}

function assertContained(root: string, target: string, label: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(label);
  }
}

/**
 * Where a workspace of any kind lives, mirroring the three Electron resolvers
 * (resolveHarnessRoot, resolveLeadHarnessRoot, resolvePermitQaqcHarnessRoot) so route
 * handlers can reach the same folders the terminal does. A record without a confirmed
 * dropbox_path is ordinary, not broken -- it just gets a workspace beside its own record.
 */
export function resolveWorkspace(kind: WorkspaceKind, slug: string): ResolvedWorkspace {
  const { recordDir, dropboxPath } = describeRecord(kind, slug);
  let workspaceRoot = recordDir;
  if (dropboxPath) {
    if (!DROPBOX_ROOT) {
      throw new Error("Select a local STUDIO Dropbox root before reading this workspace.");
    }
    workspaceRoot = resolveConfirmedProjectDir(DROPBOX_ROOT, dropboxPath);
  }
  const harnessRoot = path.join(workspaceRoot, "Mi");
  if (fs.existsSync(harnessRoot)) {
    if (!fs.statSync(harnessRoot).isDirectory()) {
      throw new Error("The agent workspace must be a directory.");
    }
    assertContained(workspaceRoot, fs.realpathSync.native(harnessRoot), "The agent workspace escapes the confirmed folder.");
  }
  return { recordDir, workspaceRoot, harnessRoot, dropboxPath };
}

function describeRecord(kind: WorkspaceKind, slug: string): { recordDir: string; dropboxPath: string | null } {
  if (kind === "project") {
    const project = getProject(slug);
    return { recordDir: path.join(PROJECTS_DIR, slug), dropboxPath: project.meta.dropbox_path ?? null };
  }
  if (kind === "lead") {
    const { lead } = getLead(slug);
    return { recordDir: leadDir(slug), dropboxPath: lead.dropbox_path ?? null };
  }
  const record = getPermitQaqcEngagement(slug);
  return { recordDir: permitQaqcDir(slug), dropboxPath: record.engagement.dropbox_path ?? null };
}

/**
 * Everything the outbox operations need, with no dependency on how a record resolves.
 *
 * Splitting this out keeps the file-format logic testable against a bare temp directory
 * and lets the Analyze pass hold one location across several operations instead of
 * re-resolving the workspace for each.
 */
export interface OutboxLocation {
  kind: WorkspaceKind;
  slug: string;
  /** <workspaceRoot>/Mi/inbox -- append-only, agent-written, never generator-owned. */
  inbox: string;
  /** Mi's own record of what a person already reviewed, kept out of the workspace. */
  resolutions: string;
}

/**
 * The append-only outbox.
 *
 * Deliberately not owned by the workspace generator. `classifyFile` treats a file
 * carrying the mi-generated marker as overwritable, which is right for a regenerable
 * view and wrong for the record of what a session learned. Nothing here carries the
 * marker, and the generator never enumerates this directory.
 */
export function locateOutbox(
  kind: WorkspaceKind,
  slug: string,
  options: { create?: boolean } = {},
): OutboxLocation | null {
  const { harnessRoot, recordDir } = resolveWorkspace(kind, slug);
  const inbox = path.join(harnessRoot, "inbox");
  if (!fs.existsSync(inbox)) {
    if (!options.create) return null;
    fs.mkdirSync(inbox, { recursive: true });
  }
  const realInbox = fs.realpathSync.native(inbox);
  assertContained(fs.realpathSync.native(harnessRoot), realInbox, "The outbox escapes the confirmed agent workspace.");
  return {
    kind,
    slug,
    inbox: realInbox,
    resolutions: path.join(recordDir, ".mi", "outbox-resolutions.json"),
  };
}

export type AppendOutboxResult =
  | { status: "saved"; id: string; fileName: string }
  | { status: "duplicate"; id: string; fileName: string }
  | { status: "invalid"; error: string };

/**
 * Writes one entry as one file. Never edits an existing entry: a re-submitted id is a
 * duplicate, not an update, so an agent re-running a script cannot rewrite the record of
 * what it previously claimed.
 */
export function appendOutboxEntryTo(location: OutboxLocation, input: unknown): AppendOutboxResult {
  const parsed = workspaceOutboxEntryInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "invalid", error: parsed.error.issues[0]?.message ?? "Invalid outbox entry." };
  }
  if (parsed.data.workspace.type !== location.kind || parsed.data.workspace.slug !== location.slug) {
    return { status: "invalid", error: "The entry names a different workspace than the one it was written to." };
  }
  const id = parsed.data.id ?? outboxEntryId(parsed.data);
  const entry = workspaceOutboxEntrySchema.parse({ ...parsed.data, id });

  const fileName = `${entry.id}.json`;
  const target = path.join(location.inbox, fileName);
  if (fs.existsSync(target)) return { status: "duplicate", id: entry.id, fileName };
  writeFileAtomically(target, `${JSON.stringify(entry, null, 2)}\n`, { expectedHash: null });
  return { status: "saved", id: entry.id, fileName };
}

export function appendOutboxEntry(kind: WorkspaceKind, slug: string, input: unknown): AppendOutboxResult {
  const location = locateOutbox(kind, slug, { create: true });
  if (!location) return { status: "invalid", error: "The agent workspace has no outbox." };
  return appendOutboxEntryTo(location, input);
}

export interface OutboxEntryRecord {
  entry: WorkspaceOutboxEntry;
  fileName: string;
  hash: string;
}

export type ParsedOutboxEntry =
  | { ok: true; entry: WorkspaceOutboxEntry }
  | { ok: false; error: string };

/**
 * Validates one inbox file's contents and supplies the id when the writer omitted one.
 *
 * The published contract does not require `id` -- an agent may write only the documented
 * body -- so anything reading the folder has to derive the same content id `appendOutboxEntryTo`
 * would have written. Deriving rather than generating is what makes a hand-dropped file
 * import once instead of once per scan.
 *
 * Returns a message rather than throwing: a malformed file is a review item a person can
 * fix, not a reason for the whole folder to fail to load.
 */
export function parseOutboxEntry(raw: unknown): ParsedOutboxEntry {
  const parsed = workspaceOutboxEntryInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".");
    return { ok: false, error: field ? `${field}: ${issue.message}` : (issue?.message ?? "Invalid entry.") };
  }
  const id = parsed.data.id ?? outboxEntryId(parsed.data);
  const entry = workspaceOutboxEntrySchema.safeParse({ ...parsed.data, id });
  if (!entry.success) {
    return { ok: false, error: entry.error.issues[0]?.message ?? "Invalid entry." };
  }
  return { ok: true, entry: entry.data };
}

/** One `.json` file in the inbox, read as bytes, before any validation. */
export interface OutboxFile {
  fileName: string;
  filePath: string;
  raw: Buffer;
  hash: string;
}

/**
 * Bounded listing of the inbox as raw files. Symlinks, oversized files, and unreadable
 * files are skipped here; malformed *contents* are deliberately not -- the review inbox
 * has to see those in order to raise a failed-import item for them.
 */
export function listOutboxFiles(location: OutboxLocation): OutboxFile[] {
  return fs.readdirSync(location.inbox, { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_ENTRY_FILES)
    .flatMap((item) => {
      const filePath = path.join(location.inbox, item.name);
      try {
        if (fs.lstatSync(filePath).isSymbolicLink()) return [];
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > MAX_ENTRY_FILE_BYTES) return [];
        const raw = fs.readFileSync(filePath);
        return [{ fileName: item.name, filePath, raw, hash: hashContent(raw) }];
      } catch {
        return [];
      }
    });
}

/** Bounded, read-only load. Invalid or oversized files are skipped, never thrown on. */
export function listOutboxEntriesIn(location: OutboxLocation): OutboxEntryRecord[] {
  return listOutboxFiles(location).flatMap((file) => {
    let json: unknown;
    try {
      json = JSON.parse(file.raw.toString("utf8").replace(/^\uFEFF/, ""));
    } catch {
      return [];
    }
    const parsed = parseOutboxEntry(json);
    if (!parsed.ok) return [];
    const { entry } = parsed;
    if (entry.workspace.type !== location.kind || entry.workspace.slug !== location.slug) return [];
    return [{ entry, fileName: file.fileName, hash: file.hash }];
  });
}

export function listOutboxEntries(kind: WorkspaceKind, slug: string): OutboxEntryRecord[] {
  try {
    const location = locateOutbox(kind, slug);
    return location ? listOutboxEntriesIn(location) : [];
  } catch {
    return [];
  }
}

const resolutionSchema = z.object({
  version: z.literal(1),
  resolved: z.array(z.object({
    entry_id: z.string().regex(SAFE_ID),
    status: z.enum(["applied", "dismissed"]),
    resolved_at: z.string().datetime(),
    reason: z.string().trim().max(500).default(""),
  })).default([]),
});
export type OutboxResolution = z.infer<typeof resolutionSchema>["resolved"][number];

/**
 * Mi's decisions about entries, kept in the record store rather than the workspace.
 *
 * Entries are append-only evidence an agent owns; resolutions are Mi's own state. Keeping
 * them apart means regenerating or repairing a workspace can never lose the record of
 * what a person already reviewed, and an agent cannot reopen a card by rewriting a file.
 */
export function readOutboxResolutionsIn(location: OutboxLocation): OutboxResolution[] {
  if (!fs.existsSync(location.resolutions)) return [];
  try {
    return resolutionSchema.parse(JSON.parse(fs.readFileSync(location.resolutions, "utf8"))).resolved;
  } catch {
    return [];
  }
}

/** Closes entries in one atomic write; a closed entry stays closed and is never reopened. */
export function resolveOutboxEntriesIn(location: OutboxLocation, input: {
  entryIds: string[];
  status: "applied" | "dismissed";
  reason?: string;
  now?: () => Date;
}): OutboxResolution[] {
  if (input.entryIds.length === 0) throw new Error("No entries were named to close.");
  const existing = readOutboxResolutionsIn(location);
  const closed = new Set(existing.map((item) => item.entry_id));
  const toClose = input.entryIds.filter((id) => !closed.has(id));
  if (toClose.length === 0) return existing;

  const resolvedAt = (input.now ?? (() => new Date()))().toISOString();
  const resolved = [
    ...existing,
    ...toClose.map((entryId) => ({
      entry_id: entryId,
      status: input.status,
      resolved_at: resolvedAt,
      reason: input.status === "dismissed" ? (input.reason ?? "") : "",
    })),
  ];
  const serialized = `${JSON.stringify(resolutionSchema.parse({ version: 1, resolved }), null, 2)}\n`;
  writeFileAtomically(location.resolutions, serialized, {
    expectedHash: readCurrentHash(location.resolutions),
  });
  return resolved;
}

export interface PendingOutbox {
  pending: OutboxEntryRecord[];
  resolved: { record: OutboxEntryRecord; resolution: OutboxResolution }[];
}

export function readOutboxIn(location: OutboxLocation): PendingOutbox {
  const records = listOutboxEntriesIn(location);
  const byId = new Map(readOutboxResolutionsIn(location).map((item) => [item.entry_id, item]));
  return {
    pending: records.filter((record) => !byId.has(record.entry.id)),
    resolved: records.flatMap((record) => {
      const resolution = byId.get(record.entry.id);
      return resolution ? [{ record, resolution }] : [];
    }),
  };
}

export function readWorkspaceOutbox(kind: WorkspaceKind, slug: string): PendingOutbox {
  try {
    const location = locateOutbox(kind, slug);
    return location ? readOutboxIn(location) : { pending: [], resolved: [] };
  } catch {
    return { pending: [], resolved: [] };
  }
}

export function resolveOutboxEntries(input: {
  kind: WorkspaceKind;
  slug: string;
  entryIds: string[];
  status: "applied" | "dismissed";
  reason?: string;
  now?: () => Date;
}): OutboxResolution[] {
  const location = locateOutbox(input.kind, input.slug, { create: true });
  if (!location) throw new Error("This workspace has no outbox.");
  return resolveOutboxEntriesIn(location, input);
}
