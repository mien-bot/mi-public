import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import {
  PERMIT_QAQC_DEFAULT_REOPEN_STATUS,
  permitQaqcEngagementSchema,
  type PermitQaqcEngagement,
} from "@/lib/schema";
import { readCurrentHash } from "./atomicContentWrite";
import { resolveFirmDataDir } from "./paths";
import { ensurePermitQaqcSubdirs } from "./scaffoldPermitQaqc";
import {
  deleteDirectoryRecoverably,
  writeYamlAtomically,
  type RecoverableDeleteResult,
  type RecoverableWriteResult,
} from "./leadLibraryAtomicWrite";
import { assertSafeWorkspaceSlug, isPathInside } from "./leadLibraryPathSafety";

export class PermitQaqcWriteError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

export interface PermitQaqcWriteOptions {
  permitQaqcDir?: string;
  /** Only consulted by updatePermitQaqcEngagement -- see writeYamlAtomically's own doc comment. */
  expectedHash?: string | null;
}

export interface PermitQaqcWriteResult extends RecoverableWriteResult {
  slug: string;
  engagement: PermitQaqcEngagement;
}

export interface PermitQaqcDeleteResult extends RecoverableDeleteResult {
  slug: string;
  engagement: PermitQaqcEngagement;
}

function firstIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid permit QAQC engagement.";
}

function validateEngagement(input: unknown): PermitQaqcEngagement {
  const parsed = permitQaqcEngagementSchema.safeParse(input);
  if (!parsed.success) throw new PermitQaqcWriteError(firstIssueMessage(parsed.error));
  return parsed.data;
}

function safeEngagementDir(permitQaqcDirRoot: string, slug: string): string {
  const target = path.resolve(permitQaqcDirRoot, slug);
  if (!isPathInside(permitQaqcDirRoot, target)) {
    throw new PermitQaqcWriteError("Engagement path escapes the permit-qaqc directory.");
  }
  return target;
}

function safeEngagementTarget(permitQaqcDirRoot: string, slug: string): string {
  return path.join(safeEngagementDir(permitQaqcDirRoot, slug), "qaqc.yaml");
}

function validatedSlug(value: unknown): string {
  try {
    return assertSafeWorkspaceSlug(value, "Permit QAQC engagement slug");
  } catch (cause) {
    throw new PermitQaqcWriteError((cause as Error).message);
  }
}

/**
 * completed_at and reopen_status follow the status transition, never the caller's payload, so a
 * form holding an older copy of the record cannot restore or erase them.
 */
function withCompletionFields(
  merged: Record<string, unknown>,
  current: PermitQaqcEngagement,
): Record<string, unknown> {
  const record = { ...merged };
  delete record.completed_at;
  delete record.reopen_status;
  if (record.status !== "closed") return record;
  if (current.status !== "closed") {
    return {
      ...record,
      completed_at: new Date().toLocaleDateString("en-CA"),
      reopen_status: current.status,
    };
  }
  return {
    ...record,
    ...(current.completed_at && { completed_at: current.completed_at }),
    ...(current.reopen_status && { reopen_status: current.reopen_status }),
  };
}

export function createPermitQaqcEngagement(
  slugInput: unknown,
  input: unknown,
  options: PermitQaqcWriteOptions = {},
): PermitQaqcWriteResult {
  const permitQaqcDirRoot = options.permitQaqcDir ?? resolveFirmDataDir("permit-qaqc").dir;
  const slug = validatedSlug(slugInput);
  const collision = fs.existsSync(permitQaqcDirRoot)
    ? fs.readdirSync(permitQaqcDirRoot).find((entry) => entry.toLowerCase() === slug)
    : undefined;
  if (collision) throw new PermitQaqcWriteError(`Permit QAQC engagement slug "${slug}" already exists.`, 409);

  const engagement = validateEngagement(input);
  const filePath = safeEngagementTarget(permitQaqcDirRoot, slug);
  const write = writeYamlAtomically(filePath, engagement);
  ensurePermitQaqcSubdirs(safeEngagementDir(permitQaqcDirRoot, slug));
  return { ...write, slug, engagement };
}

export function updatePermitQaqcEngagement(
  slugInput: unknown,
  input: unknown,
  options: PermitQaqcWriteOptions = {},
): PermitQaqcWriteResult {
  const permitQaqcDirRoot = options.permitQaqcDir ?? resolveFirmDataDir("permit-qaqc").dir;
  const slug = validatedSlug(slugInput);
  const filePath = safeEngagementTarget(permitQaqcDirRoot, slug);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new PermitQaqcWriteError(`Permit QAQC engagement "${slug}" was not found.`, 404);
  }

  const raw = loadYaml(fs.readFileSync(filePath, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PermitQaqcWriteError(`Permit QAQC engagement "${slug}" is not a YAML object.`);
  }
  const current = permitQaqcEngagementSchema.safeParse(raw);
  if (!current.success) throw new PermitQaqcWriteError(firstIssueMessage(current.error));
  const engagement = validateEngagement(input);
  const merged = withCompletionFields({ ...(raw as Record<string, unknown>), ...engagement }, current.data);
  const finalValidation = permitQaqcEngagementSchema.safeParse(merged);
  if (!finalValidation.success) throw new PermitQaqcWriteError(firstIssueMessage(finalValidation.error));

  const write = writeYamlAtomically(
    filePath,
    merged,
    options.expectedHash === undefined ? {} : { expectedHash: options.expectedHash },
  );
  return { ...write, slug, engagement: finalValidation.data };
}

/** Complete closes the engagement; reopen returns it to the status it held before. */
export function setPermitQaqcCompletion(
  slugInput: unknown,
  request: { action?: unknown; confirmed?: unknown; expectedName?: unknown },
  options: PermitQaqcWriteOptions = {},
): PermitQaqcWriteResult {
  const { action } = request;
  if (action !== "complete" && action !== "reopen") {
    throw new PermitQaqcWriteError("Choose whether to complete or reopen this engagement.");
  }
  if (request.confirmed !== true) {
    throw new PermitQaqcWriteError("Changing an engagement's completion requires explicit confirmation.");
  }

  const permitQaqcDirRoot = options.permitQaqcDir ?? resolveFirmDataDir("permit-qaqc").dir;
  const slug = validatedSlug(slugInput);
  const filePath = safeEngagementTarget(permitQaqcDirRoot, slug);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new PermitQaqcWriteError(`Permit QAQC engagement "${slug}" was not found.`, 404);
  }

  // Hash first: a write landing after this read is then caught by the update below.
  const expectedHash = readCurrentHash(filePath);
  const current = permitQaqcEngagementSchema.safeParse(loadYaml(fs.readFileSync(filePath, "utf8")));
  if (!current.success) throw new PermitQaqcWriteError(firstIssueMessage(current.error));
  const engagement = current.data;
  if (request.expectedName !== engagement.name) {
    throw new PermitQaqcWriteError("Engagement name changed. Refresh and confirm again.", 409);
  }
  if ((action === "complete") === (engagement.status === "closed")) {
    throw new PermitQaqcWriteError(
      `This engagement is already ${action === "complete" ? "completed" : "open"}. Refresh to see its current status.`,
      409,
    );
  }

  const status = action === "complete"
    ? "closed"
    : engagement.reopen_status ?? PERMIT_QAQC_DEFAULT_REOPEN_STATUS;
  return updatePermitQaqcEngagement(slug, { ...engagement, status }, { permitQaqcDir: permitQaqcDirRoot, expectedHash });
}

export function deletePermitQaqcEngagement(
  slugInput: unknown,
  confirmation: { confirmed?: unknown; expectedName?: unknown },
  options: PermitQaqcWriteOptions = {},
): PermitQaqcDeleteResult {
  if (confirmation.confirmed !== true) {
    throw new PermitQaqcWriteError("Permit QAQC engagement deletion requires explicit confirmation.");
  }

  const permitQaqcDirRoot = options.permitQaqcDir ?? resolveFirmDataDir("permit-qaqc").dir;
  const slug = validatedSlug(slugInput);
  const dir = safeEngagementDir(permitQaqcDirRoot, slug);
  const filePath = path.join(dir, "qaqc.yaml");
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new PermitQaqcWriteError(`Permit QAQC engagement "${slug}" was not found.`, 404);
  }

  const current = permitQaqcEngagementSchema.safeParse(loadYaml(fs.readFileSync(filePath, "utf8")));
  if (!current.success) throw new PermitQaqcWriteError(firstIssueMessage(current.error));
  if (confirmation.expectedName !== current.data.name) {
    throw new PermitQaqcWriteError("Engagement name changed. Refresh and confirm deletion again.", 409);
  }

  // Backs up the whole engagement folder (draft reviews included), not just the core
  // record -- this only ever touches Mi's own tracked permit-qaqc/ tree, never the
  // real Dropbox Received/Sent/Admin/Reference folder, which is untouched either way.
  const deletion = deleteDirectoryRecoverably(dir, path.join(permitQaqcDirRoot, ".mi-backups"));
  return { ...deletion, slug, engagement: current.data };
}
