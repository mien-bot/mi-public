import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { dump as dumpYaml } from "js-yaml";
import {
  projectSiteReportSchema,
  type ProjectRecordReference,
  type ProjectSiteReport,
  type SiteReportItemKind,
} from "@/lib/schema";
import { ContentConflictError, readCurrentHash, writeFileAtomically } from "./atomicContentWrite";
import { deleteFileRecoverably } from "./leadLibraryAtomicWrite";
import { isConflictedCopyName } from "./dropboxConflicts";
import { contentDir } from "./projects";

const MAX_SITE_REPORT_FILES = 500;
const MAX_SITE_REPORT_FILE_BYTES = 2_000_000;

export interface ProjectSiteReportDocument {
  report: ProjectSiteReport;
  fileName: string;
  relativePath: string;
  hash: string;
}

function siteReportDirectory(slug: string): string {
  return path.join(contentDir(slug), "site-reports");
}

function siteReportRelativePath(fileName: string): string {
  return `site-reports/${fileName}`;
}

function siteReportFiles(slug: string): string[] {
  const dir = siteReportDirectory(slug);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) =>
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      !isConflictedCopyName(entry.name),
    )
    .map((entry) => path.join(dir, entry.name))
    .sort();
  if (files.length > MAX_SITE_REPORT_FILES) {
    throw new Error(
      `Project "${slug}" has more than ${MAX_SITE_REPORT_FILES} site reports; archive or split the register before loading it.`,
    );
  }
  return files;
}

function readSiteReportFile(filePath: string): ProjectSiteReportDocument {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_SITE_REPORT_FILE_BYTES) {
    throw new Error(`Site report is not a bounded file: ${path.basename(filePath)}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const report = projectSiteReportSchema.parse(matter(raw).data);
  const fileName = path.basename(filePath);
  return {
    report,
    fileName,
    relativePath: siteReportRelativePath(fileName),
    hash: readCurrentHash(filePath) ?? "",
  };
}

function renderReference(reference: ProjectRecordReference): string {
  const target = reference.path ?? reference.url;
  const item = reference.item_id ? ` · item ${reference.item_id}` : "";
  return `- ${reference.label}${target ? ` — ${target}` : ""}${item}${
    reference.notes ? ` — ${reference.notes}` : ""
  }`;
}

const ITEM_HEADINGS: Record<SiteReportItemKind, string> = {
  "direct-observation": "Direct observations",
  "reported-information": "Reported information — not independently verified",
  interpretation: "Interpretations",
  issue: "Issues requiring review",
  "follow-up": "Proposed follow-ups",
  limitation: "Observation limitations",
};

function serializeSiteReport(report: ProjectSiteReport): string {
  const parsed = projectSiteReportSchema.parse(report);
  const frontmatter = dumpYaml(parsed, { lineWidth: 100, noRefs: true }).trim();
  const sections = (Object.keys(ITEM_HEADINGS) as SiteReportItemKind[]).map((kind) => {
    const items = parsed.items.filter((item) => item.kind === kind);
    const body = items.length > 0
      ? items.map((item) => {
        const details = [
          item.location ? `Location: ${item.location}` : "",
          item.attributed_to ? `Attributed to: ${item.attributed_to}` : "",
          item.owner ? `Proposed owner: ${item.owner}` : "",
          item.due_date ? `Proposed due date: ${item.due_date}` : "",
        ].filter(Boolean).join(" · ");
        const refs = [...item.source_refs, ...item.photo_refs];
        return `### ${item.id}${item.location ? ` — ${item.location}` : ""}

${item.text}

${details || "No additional metadata recorded."}

${refs.length > 0 ? refs.map(renderReference).join("\n") : "- No file or photo references recorded."}`;
      }).join("\n\n")
      : "None recorded.";
    return `## ${ITEM_HEADINGS[kind]}\n\n${body}`;
  }).join("\n\n");

  return `---
${frontmatter}
---

# ${parsed.title}

- **Status:** ${parsed.status}
- **Visit date:** ${parsed.visit_date}
- **Origin:** ${parsed.origin}
- **Human reviewer:** ${parsed.confirmed_by ?? "Not recorded"}

## Purpose

${parsed.purpose || "No purpose recorded."}

## Scope

${parsed.scope || "No scope recorded."}

## Conditions

- Weather: ${parsed.conditions.weather || "Not recorded"}
- Access: ${parsed.conditions.access || "Not recorded"}
- Lighting: ${parsed.conditions.lighting || "Not recorded"}
- Occupancy: ${parsed.conditions.occupancy || "Not recorded"}
- Active work: ${parsed.conditions.active_work || "Not recorded"}

## Sources

${parsed.sources.length > 0 ? parsed.sources.map(renderReference).join("\n") : "- Current notes only; no separate source recorded."}

${sections}

## Raw notes

${parsed.raw_notes || "No raw notes recorded."}

> **Professional review required:** This report records limited observations and reported
> information for project coordination. It does not establish concealed conditions or determine
> code, structural, MEP, accessibility, environmental, contractual, or life-safety compliance.
`;
}
export function getProjectSiteReports(slug: string): ProjectSiteReportDocument[] {
  const documents = siteReportFiles(slug).map(readSiteReportFile);
  const ids = new Set<string>();
  for (const document of documents) {
    if (ids.has(document.report.id)) {
      throw new Error(`Duplicate site-report id "${document.report.id}" in project "${slug}".`);
    }
    ids.add(document.report.id);
  }
  return documents.sort((left, right) =>
    `${right.report.visit_date}:${right.report.created_at}`.localeCompare(
      `${left.report.visit_date}:${left.report.created_at}`,
    ),
  );
}

export function getProjectSiteReport(
  slug: string,
  id: string,
): ProjectSiteReportDocument | null {
  const matches = getProjectSiteReports(slug).filter((document) => document.report.id === id);
  if (matches.length > 1) throw new Error(`Duplicate site-report id "${id}".`);
  return matches[0] ?? null;
}

/**
 * Removes a site report.
 *
 * A report is an observational record, so the bar for removing one is high — but a report
 * filed against the wrong project, or a duplicate from a double-submit, is not an
 * observation of anything and there was previously no way to take it back. The file is
 * copied into `.mi-backups/` before removal, and a stale hash is refused, so this can
 * neither destroy someone else's concurrent edit nor be unrecoverable.
 */
export function deleteProjectSiteReport(
  slug: string,
  id: string,
  expectedHash: string,
): { report: ProjectSiteReport; backupPath: string } {
  const existing = getProjectSiteReport(slug, id);
  if (!existing) throw new Error(`Site report "${id}" was not found.`);
  const filePath = path.join(siteReportDirectory(slug), existing.fileName);
  if (existing.hash !== expectedHash) {
    throw new ContentConflictError(filePath, expectedHash, existing.hash);
  }
  const { backupPath } = deleteFileRecoverably(filePath);
  return { report: existing.report, backupPath };
}

export function createProjectSiteReport(
  slug: string,
  input: ProjectSiteReport,
): ProjectSiteReportDocument {
  const report = projectSiteReportSchema.parse(input);
  if (getProjectSiteReport(slug, report.id)) {
    throw new Error(`Site report "${report.id}" already exists.`);
  }
  const fileName = `${report.visit_date}-${report.id}.md`;
  const filePath = path.join(siteReportDirectory(slug), fileName);
  writeFileAtomically(filePath, serializeSiteReport(report), { expectedHash: null });
  return readSiteReportFile(filePath);
}

export function updateProjectSiteReport(
  slug: string,
  id: string,
  input: ProjectSiteReport,
  expectedHash: string,
): ProjectSiteReportDocument {
  const existing = getProjectSiteReport(slug, id);
  if (!existing) throw new Error(`Site report "${id}" was not found.`);
  const report = projectSiteReportSchema.parse(input);
  if (report.id !== id) throw new Error("A site report's canonical id cannot be changed.");
  const filePath = path.join(siteReportDirectory(slug), existing.fileName);
  writeFileAtomically(filePath, serializeSiteReport(report), { expectedHash });
  return readSiteReportFile(filePath);
}
