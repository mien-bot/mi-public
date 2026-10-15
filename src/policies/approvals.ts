import { loadMiConfig } from "@/src/config";

/**
 * Approval levels from docs/mi-architecture-project-management-ai-cli.md §6.1.
 * Only Read and InternalWrite are actually exercised by this build — the
 * others are named here so future commands (drafts, professional actions,
 * external communications) have a place to slot in without re-deriving the
 * scale.
 */
export enum ApprovalLevel {
  Read = "read",
  Draft = "draft",
  InternalWrite = "internal-write",
  ImportantProfessionalAction = "important-professional-action",
  ExternalAction = "external-action",
}

export type WriteRecordType = "project" | "schedule" | "lead" | "task";

/**
 * Whether `mi notion pull --apply` may write `field` on `recordType`, per
 * mi.config.yaml's notion.allowed_write_fields. Anything not explicitly
 * listed is pull-and-display only, even with --apply — this is the actual
 * enforcement point for the InternalWrite approval level.
 */
export function isWriteAllowed(recordType: WriteRecordType, field: string): boolean {
  const config = loadMiConfig();
  const allowed = config.notion.allowed_write_fields[recordType] ?? [];
  return allowed.includes(field);
}
