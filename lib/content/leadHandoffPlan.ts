import type { ProjectCreationPlan, ProjectWorkflowProfile } from "./projectCreationPlan";

/**
 * The shape of a lead-to-project conversion, with no filesystem access -- the same
 * pure-plan/impure-apply split projectCreationPlan.ts has, so the convert dialog can import
 * these types without pulling Node's fs into the renderer bundle. See leadHandoff.ts for the
 * reader that fills these in and the writer that applies them.
 */

export const LEAD_HANDOFF_FILE = "Lead-Handoff.md";

/** Copies land in this subfolder of their destination so handoff material stays identifiable. */
export const LEAD_COPY_SUBFOLDER = "From-Lead";

/** Used when the chosen profile's destination folder was edited out of the reviewed list. */
export const LEAD_FALLBACK_FOLDER = "00_From-Lead";

export type LeadFileKind = "site-photos" | "owner-supplied" | "contracts";

export const LEAD_FILE_KINDS: LeadFileKind[] = ["site-photos", "owner-supplied", "contracts"];

export const LEAD_FILE_KIND_LABEL: Record<LeadFileKind, string> = {
  "site-photos": "Site photos",
  "owner-supplied": "Owner-supplied documents",
  contracts: "Contract drafts",
};

/**
 * Where each kind of lead file belongs in a new project folder, per workflow profile. These
 * point at the profile defaults in PROJECT_WORKFLOW_PROFILES; when a person edits the
 * destination out of the reviewed folder list, the copy falls back to LEAD_FALLBACK_FOLDER
 * rather than silently recreating a folder they just removed.
 */
export const LEAD_FILE_DESTINATIONS: Record<ProjectWorkflowProfile, Record<LeadFileKind, string>> = {
  architecture: { "site-photos": "09_SitePhotos", "owner-supplied": "00_Reference", contracts: "01_Admin" },
  interior: { "site-photos": "01_Existing-Site", "owner-supplied": "01_Existing-Site", contracts: "example-record-17" },
  permitting: {
    "site-photos": "01_Existing-Conditions",
    "owner-supplied": "03_Forms-Supporting-Docs",
    contracts: "example-record-17",
  },
  photography: { "site-photos": "01_Source", "owner-supplied": "01_Source", contracts: "example-record-17" },
  marketing: {
    "site-photos": "06_Photography-Video",
    "owner-supplied": "07_Graphics-Source",
    contracts: "example-record-17-Strategy",
  },
  lightweight: { "site-photos": "02_References", "owner-supplied": "02_References", contracts: "example-record-17" },
};

export function leadFileDestination(
  kind: LeadFileKind,
  workflow: ProjectWorkflowProfile,
  folders: string[],
): string {
  const preferred = LEAD_FILE_DESTINATIONS[workflow][kind];
  return folders.includes(preferred)
    ? `${preferred}/${LEAD_COPY_SUBFOLDER}`
    : `${LEAD_FALLBACK_FOLDER}/${kind}`;
}

export interface LeadFileCopy {
  kind: LeadFileKind;
  /** Relative to leads/<slug>/ */
  source: string;
  /** Relative to the project's Dropbox folder */
  target: string;
  bytes: number;
  /** The lead's own caption/title for this file, shown in the brief. */
  label: string;
}

export interface LeadFileExclusion {
  kind: LeadFileKind;
  source: string;
  reason: "missing" | "unsafe";
}

export interface LeadHandoffPlan {
  handoffFile: string;
  copies: LeadFileCopy[];
  /** Indexed entries that will not be copied -- reported, never quietly dropped. */
  excluded: LeadFileExclusion[];
  totalBytes: number;
  counts: {
    siteVisits: number;
    correspondence: number;
    meetings: number;
    photos: number;
    ownerSupplied: number;
    contracts: number;
  };
}

export interface LeadConversionPlan {
  project: ProjectCreationPlan;
  lead: {
    slug: string;
    name: string;
    /** Recorded for the brief only -- nothing is read out of or written into this folder. */
    dropboxFolder: string | null;
  };
  /** Null when no Dropbox root is configured, in which case no folder is created at all. */
  seed: LeadHandoffPlan | null;
  dropbox: "create" | "unavailable";
  notionPage: "create" | "skip";
}
