import type { ProjectStatus } from "@/lib/schema";

/**
 * Derives a Mi slug from a project name, matching how real slugs were actually written by
 * hand: `26_0804_ABC Clinic` becomes `26-0804-abc-clinic`, the dominant recent convention in
 * this firm's data. A suggestion only -- the New Project form keeps the field editable and
 * stops re-deriving as soon as a person types their own, same "suggest, never enforce" rule
 * the name and folder-number prefixes follow. Output always satisfies the form's
 * `[a-z0-9]+(?:-[a-z0-9]+)*` pattern, or is empty when the name carries no usable characters.
 */
export function projectSlugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const NOTION_PROJECT_TYPES = [
  "Interior Design",
  "Renovation",
  "Residential",
  "HVAC",
  "Permitting",
  "Consulting",
  "Hotel",
  "Commercial",
  "Retail",
  "Photography",
  "Marketing",
  "Web Design",
  "Other",
] as const;

export const NOTION_PROJECT_SCOPES = [
  "Interior Design",
  "DD",
  "SD",
  "CD",
  "Permitting",
  "CA",
  "HVAC",
  "Programming",
  "Marketing",
  "Web Design",
  "Photography",
  "Branding",
  "Content",
  "Campaigns",
  "Other",
] as const;

export type NotionProjectType = (typeof NOTION_PROJECT_TYPES)[number];
export type NotionProjectScope = (typeof NOTION_PROJECT_SCOPES)[number];

export const PROJECT_WORKFLOW_PROFILES = {
  architecture: {
    label: "Architecture / full design",
    // Originally matched the firm's actual "Project Template" folder under 1.00 PROJECTS/
    // verbatim (confirmed 2026-07-26). Extended 2026-07-27, confirmed by the user, with
    // 00_Reference, 08_3DModels, and 09_SitePhotos after a Dropbox organization review of
    // an existing project surfaced these as conventions worth having from day one (see
    // FOLDER_CONVENTIONS_README below for the full reasoning, including the CAD-archive and
    // multi-phase conventions that are guidance only, not pre-created folders, since they
    // only apply once a project actually has an archive revision or a second phase). Real
    // projects still vary a lot beyond this starting point, which is exactly why the folder
    // list is editable before confirming.
    description: "The firm's standard Project Template folder structure.",
    dropboxFolders: [
      "00_Reference",
      "01_Admin",
      "02_Pre-Design",
      "03_Production",
      "04_Presentation",
      "05_Plot",
      "06_Corr",
      "07_Specs",
      "08_3DModels",
      "09_SitePhotos",
    ],
  },
  interior: {
    label: "Interior design",
    description: "Concept, documentation, FF&E/materials, vendor coordination, and installation workflow.",
    dropboxFolders: [
      "example-record-17",
      "01_Existing-Site",
      "02_Concept",
      "03_Design-Development",
      "04_Documentation",
      "05_FFE-Materials",
      "06_Specifications",
      "07_Vendor-Correspondence",
      "08_Installation-CA",
      "09_Presentation",
      "99_Archive",
    ],
  },
  permitting: {
    label: "Permitting",
    description: "Lean permit-set workflow centered on submissions, reviewer comments, and approval.",
    dropboxFolders: [
      "example-record-17",
      "01_Existing-Conditions",
      "02_Permit-Drawings",
      "03_Forms-Supporting-Docs",
      "04_Submissions",
      "05_Reviewer-Corrections",
      "06_Approved-Permit",
      "07_Correspondence",
      "99_Archive",
    ],
  },
  photography: {
    label: "Photography",
    description: "Small media workflow without architecture phase, permit, MEP, or specification folders.",
    dropboxFolders: [
      "example-record-17",
      "01_Source",
      "02_Selects-Edits",
      "03_Deliverables",
      "04_Releases-Licensing",
      "99_Archive",
    ],
  },
  marketing: {
    label: "STUDIO marketing",
    description: "Firm marketing, web design, photography, campaigns, publishing, and performance tracking.",
    dropboxFolders: [
      "example-record-17-Strategy",
      "01_Brand-Standards",
      "02_Content-Calendar",
      "03_Website",
      "04_Social-Media",
      "05_Email-Campaigns",
      "06_Photography-Video",
      "07_Graphics-Source",
      "08_Reviews-Approvals",
      "09_Published-Deliverables",
      "10_Analytics",
      "99_Archive",
    ],
  },
  lightweight: {
    label: "Consulting / lightweight",
    description: "Minimal structure for consulting, graphics, websites, scans, and other compact engagements.",
    dropboxFolders: [
      "example-record-17",
      "01_Working",
      "02_References",
      "03_Deliverables",
      "99_Archive",
    ],
  },
} as const;

export type ProjectWorkflowProfile = keyof typeof PROJECT_WORKFLOW_PROFILES;
export type ProjectDropboxMode = "create" | "link-existing";

export interface ProjectCreationInput {
  name: string;
  slug: string;
  client: string;
  location: string;
  status: ProjectStatus;
  workflow: ProjectWorkflowProfile;
  projectType: NotionProjectType | null;
  scopes: NotionProjectScope[];
  dropboxFolder: string;
  /**
   * `create` builds the reviewed standard structure. `link-existing` records the exact
   * human-selected Dropbox folder without changing anything inside it.
   */
  dropboxMode?: ProjectDropboxMode;
  dropboxPath?: string | null;
  /**
   * Overrides the chosen profile's default folder list -- real projects vary too much for
   * any fixed profile to be trusted blindly (confirmed 2026-07-26 against the firm's real
   * Dropbox folders), so the UI lets a human edit the proposed list before confirming.
   * `null`/omitted falls back to the profile's default.
   */
  customFolders?: string[] | null;
}

export interface ProjectCreationPlan {
  project: {
    name: string;
    slug: string;
    client: string;
    location: string;
    status: ProjectStatus;
    workflow: ProjectWorkflowProfile;
    workflowLabel: string;
  };
  mi: {
    localPath: string;
    behavior: string;
  };
  notion: {
    database: "Studio Projects";
    projectType: NotionProjectType | null;
    scopes: NotionProjectScope[];
  };
  dropbox: {
    mode: ProjectDropboxMode;
    relativePath: string;
    folders: string[];
    agentWorkspace: "Mi";
    behavior: string;
    /** Written once at the project's Dropbox root alongside the folders above -- see FOLDER_CONVENTIONS_README and DROPBOX_IGNORE_CONTENT. */
    files: { relativePath: string; content: string }[];
  };
}

/**
 * Transient CAD lock/backup files -- not meaningful version history, just noise. Dropbox
 * has no native ignore-file mechanism, so this is a documented convention for this firm's
 * CAD tools and any local cleanup scripts to honor, not an enforced technical block.
 */
export const DROPBOX_IGNORE_CONTENT = `# Transient CAD lock/backup files -- not meaningful version history.
# Dropbox has no native support for an ignore file; this documents the convention this
# firm's CAD tools and any cleanup scripts should honor. See README.md in this folder.
*.bak
*.dwl
*.dwl2
*.dwl2~
hardcopy.log
plot.log
`;

/**
 * Conventions confirmed 2026-07-27 after a Dropbox organization review of an existing
 * project (07_SampleStudio) whose file organization had become hard to navigate -- not an
 * invented scheme. Dropped into every newly scaffolded project's Dropbox root regardless
 * of workflow profile; only the "architecture" profile currently pre-creates the matching
 * 00_Reference/03_Production/Archive/08_3DModels/09_SitePhotos folders by default (see
 * PROJECT_WORKFLOW_PROFILES above), since it's the only profile confirmed against the
 * firm's real "Project Template" folder. Other profiles can add a Reference folder etc.
 * through the editable folder list before confirming if a project needs one.
 */
export const FOLDER_CONVENTIONS_README = `# Project folder conventions

Confirmed 2026-07-27 after a review of an existing project's Dropbox folder found it hard
to tell what was current production vs. reference vs. archive vs. site documentation.
Follow these so future projects don't end up the same way.

## Reference / precedent projects

Drawings or documents from OTHER jobs, kept here only for guidance, live in their own
top-level folder: \`00_Reference/<precedent-project-name>/\`. Never nest another project's
files inside this project's own Archive tree -- they aren't this project's history.

## CAD archive

Keep archive folders flat: \`Archive/<date-or-revision>/\` (one level). Don't nest
Archive-inside-Archive-inside-Reference chains.

## Transient CAD files

\`.bak\`, \`.dwl\`, \`.dwl2\`, \`.dwl2~\`, \`hardcopy.log\`, and \`plot.log\` aren't meaningful
version history -- see \`.dropboxignore\` in this folder. Clean them up when you notice them
instead of keeping them as if they were real revisions.

## Site visits and photos

Name these \`YYYY-MM-DD_<short-description>/\` (e.g. \`2025-03-06_ExistingConditions\`), not a
bare date. If a subfolder's contents aren't obvious from its name (a floor label, a photo
category) and it holds more than about 20 files, add a one-line README.md inside it.

## 3D models

Keep source model files separate from exported production output:
- \`Source/\` -- native model files (.skp, .dwg, and similar)
- \`Renders/\` -- exported renders and marketing images

## Multi-phase projects at one address

When a later phase is tracked as its own separate Mi project at the same address, split the
*shared* CAD production folder at the top level so it's unambiguous which phase/Mi project
each file belongs to -- e.g. \`Phase1/\` and \`Phase2/\` inside the production folder. Don't
create a second parallel production tree; add the phase split inside the one that already
exists.
`;

export function safeDropboxFolder(value: string): string | null {
  const trimmed = value.trim().replace(/[. ]+$/g, "");
  if (!trimmed || trimmed === "." || trimmed === ".." || /[<>:"/\\|?*]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Validates a complete path relative to DROPBOX_ROOT without resolving or inferring it. */
export function safeDropboxRelativePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const rawSegments = value.trim().replaceAll("\\", "/").split("/");
  if (rawSegments.length === 0) return null;
  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (!segment || segment === "." || segment === "..") return null;
    const safe = safeDropboxFolder(segment);
    if (!safe) return null;
    segments.push(safe);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

/**
 * Validates a user-edited folder list (e.g. "03_Design/01_SD" for a nested folder) --
 * each path segment is checked like safeDropboxFolder, but "/" is allowed as a separator.
 * Returns null (reject the whole request) if any entry is unsafe; never partially applies.
 */
export function safeDropboxFolderList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const cleaned: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const segments: string[] = [];
    for (const rawSegment of raw.split("/")) {
      const trimmed = rawSegment.trim();
      // Reject "."/".." before trailing-dot stripping -- stripping a segment that's
      // *entirely* dots (e.g. "..") down to "." rules would otherwise erase the very
      // traversal token this check exists to catch.
      if (!trimmed) continue;
      if (trimmed === "." || trimmed === "..") return null;
      const stripped = trimmed.replace(/[. ]+$/g, "");
      if (!stripped || stripped === "." || stripped === ".." || /[<>:"\\|?*]/.test(stripped)) return null;
      segments.push(stripped);
    }
    if (segments.length === 0) return null;
    cleaned.push(segments.join("/"));
  }
  if (cleaned.length === 0) return null;
  return [...new Set(cleaned)];
}

export function isProjectWorkflowProfile(value: unknown): value is ProjectWorkflowProfile {
  return typeof value === "string" && value in PROJECT_WORKFLOW_PROFILES;
}

export function isNotionProjectType(value: unknown): value is NotionProjectType {
  return typeof value === "string" && (NOTION_PROJECT_TYPES as readonly string[]).includes(value);
}

export function parseNotionProjectScopes(value: unknown): NotionProjectScope[] | null {
  if (!Array.isArray(value)) return [];
  const unique = [...new Set(value)];
  if (!unique.every((scope) =>
    typeof scope === "string" && (NOTION_PROJECT_SCOPES as readonly string[]).includes(scope))) {
    return null;
  }
  return unique as NotionProjectScope[];
}

export function buildProjectCreationPlan(input: ProjectCreationInput): ProjectCreationPlan {
  const profile = PROJECT_WORKFLOW_PROFILES[input.workflow];
  const dropboxMode = input.dropboxMode ?? "create";
  const relativePath = dropboxMode === "link-existing"
    ? input.dropboxPath ?? ""
    : `1.00 PROJECTS/${input.dropboxFolder}`;
  return {
    project: {
      name: input.name,
      slug: input.slug,
      client: input.client,
      location: input.location,
      status: input.status,
      workflow: input.workflow,
      workflowLabel: profile.label,
    },
    mi: {
      localPath: `projects/${input.slug}`,
      behavior: "Creates the standard lightweight Mi tracking record; source documents stay in Dropbox.",
    },
    notion: {
      database: "Studio Projects",
      projectType: input.projectType,
      scopes: input.scopes,
    },
    dropbox: {
      mode: dropboxMode,
      relativePath,
      folders: dropboxMode === "create" ? input.customFolders ?? [...profile.dropboxFolders] : [],
      agentWorkspace: "Mi",
      behavior: dropboxMode === "create"
        ? "Creates the reviewed folder structure after explicit confirmation."
        : "Links this existing folder only; its current contents are not changed.",
      files: dropboxMode === "create" ? [
        { relativePath: "README.md", content: FOLDER_CONVENTIONS_README },
        { relativePath: ".dropboxignore", content: DROPBOX_IGNORE_CONTENT },
      ] : [],
    },
  };
}
