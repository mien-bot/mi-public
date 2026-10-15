import path from "node:path";
import {
  permitQaqcEngagementSchema,
  reviewFrontmatterSchema,
  type PermitQaqcEngagement,
  type ReviewFrontmatter,
} from "@/lib/schema";
import { readCurrentHash } from "./atomicContentWrite";
import { listDirs, listFiles, readMarkdownFile, readYamlFile, type MarkdownDoc } from "./fsUtils";
import { resolveFirmDataDir } from "./paths";

export interface PermitQaqcRecord {
  slug: string;
  engagement: PermitQaqcEngagement;
}

/** permitQaqcDir defaults to the resolved firm-wide permit-qaqc directory; overridable for tests. */
export function permitQaqcDir(slug: string, permitQaqcDirRoot: string = resolveFirmDataDir("permit-qaqc").dir): string {
  return path.join(permitQaqcDirRoot, slug);
}

/** permit-qaqc/<slug>/qaqc.yaml — one folder per engagement, linked to its real Dropbox Received/Sent/Admin/Reference folder. */
export function getPermitQaqcSlugs(permitQaqcDirRoot: string = resolveFirmDataDir("permit-qaqc").dir): string[] {
  return listDirs(permitQaqcDirRoot);
}

export function getPermitQaqcEngagement(slug: string, permitQaqcDirRoot?: string): PermitQaqcRecord {
  const filePath = path.join(permitQaqcDir(slug, permitQaqcDirRoot), "qaqc.yaml");
  return { slug, engagement: readYamlFile(filePath, (data) => permitQaqcEngagementSchema.parse(data)) };
}

/**
 * Same as getPermitQaqcEngagement, plus the file's current hash -- for the edit form to capture
 * at read time and echo back as expectedHash on save, so a concurrent edit (another Mi instance
 * sharing this firm's Dropbox-migrated permit-qaqc engagements) is detected instead of silently
 * overwritten. See getLeadWithHash (lib/content/leads.ts) for the identical pattern.
 */
export function getPermitQaqcEngagementWithHash(
  slug: string,
  permitQaqcDirRoot?: string,
): PermitQaqcRecord & { hash: string | null } {
  const record = getPermitQaqcEngagement(slug, permitQaqcDirRoot);
  return { ...record, hash: readCurrentHash(path.join(permitQaqcDir(slug, permitQaqcDirRoot), "qaqc.yaml")) };
}

export function getAllPermitQaqcEngagements(permitQaqcDirRoot?: string): PermitQaqcRecord[] {
  return getPermitQaqcSlugs(permitQaqcDirRoot).map((slug) => getPermitQaqcEngagement(slug, permitQaqcDirRoot));
}

/**
 * permit-qaqc/<slug>/reviews/*.md — draft findings written by the AI review skill
 * (Phase 2). Reuses the exact same reviewFrontmatterSchema/MarkdownDoc shape as a
 * project's own reviews/ folder (lib/content/projects.ts's getReviews) rather than
 * inventing a parallel format. Every entry here is a draft an architect must confirm —
 * see permitQaqcEngagementSchema's doc comment and docs referenced from the plan.
 */
export function getPermitQaqcReviews(slug: string, permitQaqcDirRoot?: string): MarkdownDoc<ReviewFrontmatter>[] {
  const dir = path.join(permitQaqcDir(slug, permitQaqcDirRoot), "reviews");
  return listFiles(dir, ".md")
    .map((file) => readMarkdownFile(path.join(dir, file), (data) => reviewFrontmatterSchema.parse(data)))
    .sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date));
}
