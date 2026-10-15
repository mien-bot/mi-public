import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { permitQaqcEngagementSchema, type PermitQaqcEngagement } from "@/lib/schema";
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
  const merged = { ...(raw as Record<string, unknown>), ...engagement };
  const finalValidation = permitQaqcEngagementSchema.safeParse(merged);
  if (!finalValidation.success) throw new PermitQaqcWriteError(firstIssueMessage(finalValidation.error));

  const write = writeYamlAtomically(
    filePath,
    merged,
    options.expectedHash === undefined ? {} : { expectedHash: options.expectedHash },
  );
  return { ...write, slug, engagement: finalValidation.data };
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
