import path from "node:path";
import {
  communicationIndexSchema,
  leadPhotoIndexSchema,
  leadSchema,
  libraryIndexSchema,
  siteVisitIndexSchema,
  type CommunicationEntry,
  type Lead,
  type LeadPhotoEntry,
  type LibraryDocument,
  type SiteVisitEntry,
} from "@/lib/schema";
import { readCurrentHash } from "./atomicContentWrite";
import { listDirs, readYamlFile, readYamlFileIfExists } from "./fsUtils";
import { resolveFirmDataDir } from "./paths";

export interface LeadRecord {
  slug: string;
  lead: Lead;
}

/** leadsDir defaults to the resolved firm-wide leads directory; overridable for tests. */
export function leadDir(slug: string, leadsDir: string = resolveFirmDataDir("leads").dir): string {
  return path.join(leadsDir, slug);
}

/** leads/<slug>/lead.yaml — one folder per lead (site visits, contracts, photos, communications live alongside it). */
export function getLeadSlugs(leadsDir: string = resolveFirmDataDir("leads").dir): string[] {
  return listDirs(leadsDir);
}

export function getLead(slug: string, leadsDir?: string): LeadRecord {
  const filePath = path.join(leadDir(slug, leadsDir), "lead.yaml");
  return { slug, lead: readYamlFile(filePath, (data) => leadSchema.parse(data)) };
}

/**
 * Same as getLead, plus the file's current hash -- for the edit form to capture at read time
 * and echo back as expectedHash on save, so a concurrent edit (another Mi instance sharing this
 * firm's Dropbox-migrated leads) is detected instead of silently overwritten. See
 * getProjectDetailsWithHash (lib/content/projectWorkspace.ts) for the identical pattern.
 */
export function getLeadWithHash(slug: string, leadsDir?: string): LeadRecord & { hash: string | null } {
  const record = getLead(slug, leadsDir);
  return { ...record, hash: readCurrentHash(path.join(leadDir(slug, leadsDir), "lead.yaml")) };
}

export function getAllLeads(leadsDir?: string): LeadRecord[] {
  return getLeadSlugs(leadsDir).map((slug) => getLead(slug, leadsDir));
}

/** Leads that converted into this project — derived by matching converted_project_slug. */
export function getLeadsForProject(projectSlug: string): LeadRecord[] {
  return getAllLeads().filter((record) => record.lead.converted_project_slug === projectSlug);
}

export function getSiteVisits(slug: string, leadsDir?: string): SiteVisitEntry[] {
  const filePath = path.join(leadDir(slug, leadsDir), "site-visits", "index.yaml");
  return readYamlFileIfExists(filePath, (data) => siteVisitIndexSchema.parse(data), []);
}

/** Computed, not authored — the most recent site visit date, or null if none logged yet. */
export function getLastSiteVisitDate(slug: string, leadsDir?: string): string | null {
  const visits = getSiteVisits(slug, leadsDir);
  if (visits.length === 0) return null;
  return visits.reduce((latest, visit) => (visit.date > latest ? visit.date : latest), visits[0].date);
}

/** leads/<slug>/correspondence/index.yaml — a lightweight contact log (calls, emails, texts). */
export function getCommunications(slug: string, leadsDir?: string): CommunicationEntry[] {
  const filePath = path.join(leadDir(slug, leadsDir), "correspondence", "index.yaml");
  return readYamlFileIfExists(filePath, (data) => communicationIndexSchema.parse(data), []);
}

/** leads/<slug>/site-photos/index.yaml — photos taken during site visits. */
export function getLeadPhotos(slug: string, leadsDir?: string): LeadPhotoEntry[] {
  const filePath = path.join(leadDir(slug, leadsDir), "site-photos", "index.yaml");
  return readYamlFileIfExists(filePath, (data) => leadPhotoIndexSchema.parse(data), []);
}

/**
 * leads/<slug>/contracts/index.yaml and leads/<slug>/owner-supplied/index.yaml — same
 * LibraryDocument shape/reader as a project's contracts, just different roots.
 * "owner-supplied" is anything the owner hands over (existing plans, surveys, deeds,
 * prior permits) — distinct from contracts (ours) and correspondence (a log, not files).
 */
export const LEAD_DOCUMENT_FOLDERS = ["contracts", "owner-supplied"] as const;
export type LeadDocumentFolder = (typeof LEAD_DOCUMENT_FOLDERS)[number];

export function getLeadDocuments(slug: string, folder: LeadDocumentFolder, leadsDir?: string): LibraryDocument[] {
  const filePath = path.join(leadDir(slug, leadsDir), folder, "index.yaml");
  return readYamlFileIfExists(filePath, (data) => libraryIndexSchema.parse(data ?? []), []);
}
