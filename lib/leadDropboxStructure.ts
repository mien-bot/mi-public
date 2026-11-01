import { PROJECT_WORKFLOW_PROFILES } from "./content/projectCreationPlan";

/** Shared by the review UI and writer so confirmation describes the exact folders created. */
export const LEAD_DROPBOX_SUBFOLDERS = [
  ...PROJECT_WORKFLOW_PROFILES.architecture.dropboxFolders,
  "Mi",
] as const;
