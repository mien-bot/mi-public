import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import {
  communicationEntrySchema,
  communicationIndexSchema,
  leadSchema,
  siteVisitEntrySchema,
  siteVisitIndexSchema,
  type CommunicationEntry,
  type Lead,
  type SiteVisitEntry,
} from "@/lib/schema";
import { readYamlFileIfExists } from "./fsUtils";
import { leadDir } from "./leads";
import { PROJECTS_DIR, resolveFirmDataDir } from "./paths";
import { ensureLeadSubdirs } from "./scaffoldLead";
import {
  deleteDirectoryRecoverably,
  writeYamlAtomically,
  type RecoverableDeleteResult,
  type RecoverableWriteResult,
} from "./leadLibraryAtomicWrite";
import { assertSafeWorkspaceSlug, isPathInside } from "./leadLibraryPathSafety";

export class LeadWriteError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

export interface LeadWriteOptions {
  leadsDir?: string;
  projectsDir?: string;
  /** Only consulted by updateLead -- see writeYamlAtomically's own doc comment for the "must not have changed since read" semantics. */
  expectedHash?: string | null;
}

export interface LeadWriteResult extends RecoverableWriteResult {
  slug: string;
  lead: Lead;
  previousConvertedProjectSlug: string | null;
}

export interface LeadDeleteResult extends RecoverableDeleteResult {
  slug: string;
  lead: Lead;
  previousConvertedProjectSlug: string | null;
}

export interface SiteVisitDeleteResult extends RecoverableWriteResult {
  slug: string;
  visit: SiteVisitEntry;
}

function firstIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid lead.";
}

function validateLead(input: unknown, projectsDir: string): Lead {
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) throw new LeadWriteError(firstIssueMessage(parsed.error));
  const convertedSlug = parsed.data.converted_project_slug;
  if (convertedSlug) {
    let safeProjectSlug: string;
    try {
      safeProjectSlug = assertSafeWorkspaceSlug(convertedSlug, "Converted project slug");
    } catch (cause) {
      throw new LeadWriteError((cause as Error).message);
    }
    if (!fs.existsSync(path.join(projectsDir, safeProjectSlug, "project.yaml"))) {
      throw new LeadWriteError(`Project "${safeProjectSlug}" does not exist locally.`);
    }
  }
  return parsed.data;
}

function safeLeadDir(leadsDir: string, slug: string): string {
  const target = path.resolve(leadsDir, slug);
  if (!isPathInside(leadsDir, target)) throw new LeadWriteError("Lead path escapes the leads directory.");
  return target;
}

function safeLeadTarget(leadsDir: string, slug: string): string {
  return path.join(safeLeadDir(leadsDir, slug), "lead.yaml");
}

function validatedSlug(value: unknown): string {
  try {
    return assertSafeWorkspaceSlug(value, "Lead slug");
  } catch (cause) {
    throw new LeadWriteError((cause as Error).message);
  }
}

export function createLead(
  slugInput: unknown,
  input: unknown,
  options: LeadWriteOptions = {},
): LeadWriteResult {
  const leadsDir = options.leadsDir ?? resolveFirmDataDir("leads").dir;
  const projectsDir = options.projectsDir ?? PROJECTS_DIR;
  const slug = validatedSlug(slugInput);
  const collision = fs.existsSync(leadsDir)
    ? fs.readdirSync(leadsDir).find((entry) => entry.toLowerCase() === slug)
    : undefined;
  if (collision) throw new LeadWriteError(`Lead slug "${slug}" already exists.`, 409);

  const lead = validateLead(input, projectsDir);
  const filePath = safeLeadTarget(leadsDir, slug);
  const write = writeYamlAtomically(filePath, lead);
  ensureLeadSubdirs(safeLeadDir(leadsDir, slug));
  return { ...write, slug, lead, previousConvertedProjectSlug: null };
}

export function updateLead(
  slugInput: unknown,
  input: unknown,
  options: LeadWriteOptions = {},
): LeadWriteResult {
  const leadsDir = options.leadsDir ?? resolveFirmDataDir("leads").dir;
  const projectsDir = options.projectsDir ?? PROJECTS_DIR;
  const slug = validatedSlug(slugInput);
  const filePath = safeLeadTarget(leadsDir, slug);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new LeadWriteError(`Lead "${slug}" was not found.`, 404);
  }

  const raw = loadYaml(fs.readFileSync(filePath, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new LeadWriteError(`Lead "${slug}" is not a YAML object.`);
  }
  const current = leadSchema.safeParse(raw);
  if (!current.success) throw new LeadWriteError(firstIssueMessage(current.error));
  const lead = validateLead(input, projectsDir);
  const merged = { ...(raw as Record<string, unknown>), ...lead };
  const finalValidation = leadSchema.safeParse(merged);
  if (!finalValidation.success) throw new LeadWriteError(firstIssueMessage(finalValidation.error));

  const write = writeYamlAtomically(
    filePath,
    merged,
    options.expectedHash === undefined ? {} : { expectedHash: options.expectedHash },
  );
  return {
    ...write,
    slug,
    lead: finalValidation.data,
    previousConvertedProjectSlug: current.data.converted_project_slug,
  };
}

export function deleteLead(
  slugInput: unknown,
  confirmation: { confirmed?: unknown; expectedName?: unknown },
  options: LeadWriteOptions = {},
): LeadDeleteResult {
  if (confirmation.confirmed !== true) {
    throw new LeadWriteError("Lead deletion requires explicit confirmation.");
  }

  const leadsDir = options.leadsDir ?? resolveFirmDataDir("leads").dir;
  const slug = validatedSlug(slugInput);
  const dir = safeLeadDir(leadsDir, slug);
  const filePath = path.join(dir, "lead.yaml");
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new LeadWriteError(`Lead "${slug}" was not found.`, 404);
  }

  const current = leadSchema.safeParse(loadYaml(fs.readFileSync(filePath, "utf8")));
  if (!current.success) throw new LeadWriteError(firstIssueMessage(current.error));
  if (confirmation.expectedName !== current.data.name) {
    throw new LeadWriteError("Lead name changed. Refresh and confirm deletion again.", 409);
  }

  // Backs up the whole lead folder (site visits, contracts, site photos, owner-supplied docs,
  // correspondence), not just
  // the core record, since deleting a lead now means deleting all of its accumulated content.
  const deletion = deleteDirectoryRecoverably(dir, path.join(leadsDir, ".mi-backups"));
  return {
    ...deletion,
    slug,
    lead: current.data,
    previousConvertedProjectSlug: current.data.converted_project_slug,
  };
}

function assertLeadExists(dir: string, slug: string): void {
  if (!fs.existsSync(path.join(dir, "lead.yaml"))) {
    throw new LeadWriteError(`Lead "${slug}" was not found.`, 404);
  }
}

/** Appends one reviewed site-visit entry without changing prior entries. */
export function addSiteVisit(slugInput: unknown, input: unknown, options: LeadWriteOptions = {}): SiteVisitEntry {
  const slug = validatedSlug(slugInput);
  const dir = leadDir(slug, options.leadsDir);
  assertLeadExists(dir, slug);
  const parsed = siteVisitEntrySchema.safeParse(input);
  if (!parsed.success) throw new LeadWriteError(firstIssueMessage(parsed.error));

  const filePath = path.join(dir, "site-visits", "index.yaml");
  const current = readYamlFileIfExists(filePath, (data) => siteVisitIndexSchema.parse(data ?? []), []);
  writeYamlAtomically(filePath, [...current, parsed.data]);
  return parsed.data;
}

export function deleteSiteVisit(
  slugInput: unknown,
  visitIdInput: unknown,
  confirmation: { confirmed?: unknown; expectedDate?: unknown },
  options: LeadWriteOptions = {},
): SiteVisitDeleteResult {
  if (confirmation.confirmed !== true) {
    throw new LeadWriteError("Site visit deletion requires explicit confirmation.");
  }
  if (typeof visitIdInput !== "string" || !visitIdInput) {
    throw new LeadWriteError("Choose an exact site visit to delete.");
  }

  const slug = validatedSlug(slugInput);
  const dir = leadDir(slug, options.leadsDir);
  assertLeadExists(dir, slug);
  const filePath = path.join(dir, "site-visits", "index.yaml");
  const current = readYamlFileIfExists(filePath, (data) => siteVisitIndexSchema.parse(data ?? []), []);
  const matches = current
    .map((visit, index) => ({ visit, index }))
    .filter(({ visit }) => visit.id === visitIdInput);
  if (matches.length === 0) throw new LeadWriteError("That site visit was not found.", 404);
  if (matches.length > 1) {
    throw new LeadWriteError("Duplicate site-visit IDs require manual review before deletion.", 409);
  }

  const [{ visit, index }] = matches;
  if (confirmation.expectedDate !== visit.date) {
    throw new LeadWriteError("The site visit changed. Refresh and confirm deletion again.", 409);
  }
  const write = writeYamlAtomically(filePath, current.filter((_, entryIndex) => entryIndex !== index));
  return { ...write, slug, visit };
}

/**
 * Removes one correspondence entry from a lead's log.
 *
 * The log is a single YAML array, so this is a filter plus an atomic rewrite rather than a
 * file deletion. A mis-logged call or a duplicate entry previously had no way out of the
 * record at all.
 */
export function deleteCommunication(
  slugInput: unknown,
  id: unknown,
  options: LeadWriteOptions = {},
): CommunicationEntry {
  const slug = validatedSlug(slugInput);
  const dir = leadDir(slug, options.leadsDir);
  assertLeadExists(dir, slug);
  if (typeof id !== "string" || id.length === 0) {
    throw new LeadWriteError("A correspondence entry id is required.");
  }

  const filePath = path.join(dir, "correspondence", "index.yaml");
  const current = readYamlFileIfExists(filePath, (data) => communicationIndexSchema.parse(data ?? []), []);
  const existing = current.find((entry) => entry.id === id);
  if (!existing) throw new LeadWriteError(`Correspondence entry "${id}" was not found.`, 404);
  writeYamlAtomically(filePath, current.filter((entry) => entry.id !== id));
  return existing;
}

export function addCommunication(slugInput: unknown, input: unknown, options: LeadWriteOptions = {}): CommunicationEntry {
  const slug = validatedSlug(slugInput);
  const dir = leadDir(slug, options.leadsDir);
  assertLeadExists(dir, slug);
  const parsed = communicationEntrySchema.safeParse(input);
  if (!parsed.success) throw new LeadWriteError(firstIssueMessage(parsed.error));

  const filePath = path.join(dir, "correspondence", "index.yaml");
  const current = readYamlFileIfExists(filePath, (data) => communicationIndexSchema.parse(data ?? []), []);
  writeYamlAtomically(filePath, [...current, parsed.data]);
  return parsed.data;
}
