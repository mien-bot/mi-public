import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { dump as dumpYaml } from "js-yaml";
import {
  projectDecisionSchema,
  type ProjectDecision,
  type ProjectRecordReference,
} from "@/lib/schema";
import {
  ContentConflictError,
  readCurrentHash,
  writeFileAtomically,
} from "./atomicContentWrite";
import { deleteFileRecoverably } from "./leadLibraryAtomicWrite";
import { isConflictedCopyName } from "./dropboxConflicts";
import { contentDir } from "./projects";

const MAX_DECISION_FILES = 500;
const MAX_DECISION_FILE_BYTES = 1_000_000;

export interface ProjectDecisionDocument {
  decision: ProjectDecision;
  fileName: string;
  relativePath: string;
  hash: string;
}

export class DecisionSupersessionPartialError extends Error {
  replacement: ProjectDecisionDocument;

  constructor(replacement: ProjectDecisionDocument, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `The replacement decision was saved, but the original could not be marked superseded: ${detail}`,
    );
    this.name = "DecisionSupersessionPartialError";
    this.replacement = replacement;
  }
}

function decisionDirectory(slug: string): string {
  return path.join(contentDir(slug), "decisions");
}

function decisionRelativePath(fileName: string): string {
  return `decisions/${fileName}`;
}

function readDecisionFile(filePath: string): ProjectDecisionDocument {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_DECISION_FILE_BYTES) {
    throw new Error(`Decision record is not a bounded file: ${path.basename(filePath)}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const decision = projectDecisionSchema.parse(matter(raw).data);
  const fileName = path.basename(filePath);
  return {
    decision,
    fileName,
    relativePath: decisionRelativePath(fileName),
    hash: readCurrentHash(filePath) ?? "",
  };
}

function decisionFiles(slug: string): string[] {
  const dir = decisionDirectory(slug);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) =>
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      !isConflictedCopyName(entry.name),
    )
    .map((entry) => path.join(dir, entry.name))
    .sort();
  if (files.length > MAX_DECISION_FILES) {
    throw new Error(
      `Project "${slug}" has more than ${MAX_DECISION_FILES} decision records; archive or split the register before loading it.`,
    );
  }
  return files;
}

function renderReference(reference: ProjectRecordReference): string {
  const target = reference.path ?? reference.url;
  const item = reference.item_id ? ` · item ${reference.item_id}` : "";
  const date = reference.source_date ? ` · ${reference.source_date}` : "";
  return `- ${reference.label}${target ? ` — ${target}` : ""}${item}${date}${
    reference.notes ? ` — ${reference.notes}` : ""
  }`;
}

function renderList(values: string[], empty: string): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`;
}

function serializeDecision(decision: ProjectDecision): string {
  const parsed = projectDecisionSchema.parse(decision);
  const frontmatter = dumpYaml(parsed, { lineWidth: 100, noRefs: true }).trim();
  const options = parsed.options.length > 0
    ? parsed.options.map((option) =>
      `### ${option.label}\n\n${option.summary || "No summary recorded."}`,
    ).join("\n\n")
    : "No alternatives recorded.";
  return `---
${frontmatter}
---

# ${parsed.title}

- **Status:** ${parsed.status}
- **Decision date:** ${parsed.decision_date}
- **Confirmed by:** ${parsed.confirmed_by ?? "Not recorded"}

## Context

${parsed.context || "No context recorded."}

## Options considered

${options}

## Outcome

${parsed.outcome || "No outcome recorded; this remains a proposal."}

## Rationale

${parsed.rationale || "No rationale recorded."}

## Consequences

${renderList(parsed.consequences, "None recorded")}

## Affected deliverables

${renderList(parsed.affected_deliverables, "None recorded")}

## Sources

${parsed.sources.map(renderReference).join("\n")}

## Supersession

- Supersedes: ${parsed.supersedes ?? "None"}
- Superseded by: ${parsed.superseded_by ?? "None"}
`;
}
export function getProjectDecisions(slug: string): ProjectDecisionDocument[] {
  const documents = decisionFiles(slug).map(readDecisionFile);
  const ids = new Set<string>();
  for (const document of documents) {
    if (ids.has(document.decision.id)) {
      throw new Error(`Duplicate decision id "${document.decision.id}" in project "${slug}".`);
    }
    ids.add(document.decision.id);
  }
  return documents.sort((left, right) =>
    `${right.decision.decision_date}:${right.decision.recorded_at}`.localeCompare(
      `${left.decision.decision_date}:${left.decision.recorded_at}`,
    ),
  );
}

export function getProjectDecision(
  slug: string,
  id: string,
): ProjectDecisionDocument | null {
  const matches = getProjectDecisions(slug).filter((document) => document.decision.id === id);
  if (matches.length > 1) throw new Error(`Duplicate decision id "${id}".`);
  return matches[0] ?? null;
}

export function createProjectDecision(
  slug: string,
  input: ProjectDecision,
): ProjectDecisionDocument {
  const decision = projectDecisionSchema.parse(input);
  if (getProjectDecision(slug, decision.id)) {
    throw new Error(`Decision "${decision.id}" already exists.`);
  }
  const fileName = `${decision.decision_date}-${decision.id}.md`;
  const filePath = path.join(decisionDirectory(slug), fileName);
  writeFileAtomically(filePath, serializeDecision(decision), { expectedHash: null });
  return readDecisionFile(filePath);
}

export function updateProjectDecision(
  slug: string,
  id: string,
  input: ProjectDecision,
  expectedHash: string,
): ProjectDecisionDocument {
  const existing = getProjectDecision(slug, id);
  if (!existing) throw new Error(`Decision "${id}" was not found.`);
  const decision = projectDecisionSchema.parse(input);
  if (decision.id !== id) throw new Error("A decision's canonical id cannot be changed.");
  const filePath = path.join(decisionDirectory(slug), existing.fileName);
  writeFileAtomically(filePath, serializeDecision(decision), { expectedHash });
  return readDecisionFile(filePath);
}

/**
 * Removes a decision record.
 *
 * Superseding is the right move for a decision that was genuinely made and then changed —
 * it keeps the history. Deleting is for a record that should never have existed: a mistaken
 * promotion, a duplicate, a line of meeting notes that turned out not to be a decision at
 * all. Superseding those would leave a permanent trail of noise pretending to be history.
 *
 * The file is copied into `.mi-backups/` before it is removed, exactly as lead deletion
 * does, so an accidental delete is recoverable from disk rather than gone. The hash check
 * is the same optimistic-concurrency guard every other decision mutation uses: if the
 * record changed since the page loaded, the caller is told to reload rather than silently
 * destroying someone else's edit.
 *
 * A decision that other records point at is refused — see `supersedes`/`superseded_by`.
 * Deleting one half of a supersession chain would leave the other half referring to a
 * record that no longer exists.
 */
export function deleteProjectDecision(
  slug: string,
  id: string,
  expectedHash: string,
): { decision: ProjectDecision; backupPath: string } {
  const existing = getProjectDecision(slug, id);
  if (!existing) throw new Error(`Decision "${id}" was not found.`);
  const filePath = path.join(decisionDirectory(slug), existing.fileName);
  if (existing.hash !== expectedHash) {
    throw new ContentConflictError(filePath, expectedHash, existing.hash);
  }
  if (existing.decision.superseded_by) {
    throw new Error(
      "This record was superseded, so it is part of a history chain. Delete the replacement first if the whole chain is wrong.",
    );
  }
  // Both directions of the link matter. A record that something else *replaces* is covered
  // by the superseded_by check above; this catches the other half — a replacement whose
  // removal would leave the original marked `superseded_by` an id that no longer resolves.
  const others = getProjectDecisions(slug).filter((document) => document.decision.id !== id);
  const replaces = others.find((document) => document.decision.supersedes === id);
  if (replaces) {
    throw new Error(
      `Decision "${replaces.decision.id}" records that it replaces this one. Delete that replacement first.`,
    );
  }
  const replacedBy = others.find((document) => document.decision.superseded_by === id);
  if (replacedBy) {
    throw new Error(
      `Decision "${replacedBy.decision.id}" records that this one replaces it. Deleting this would leave that record pointing at nothing.`,
    );
  }

  const { backupPath } = deleteFileRecoverably(filePath);
  return { decision: existing.decision, backupPath };
}

export function supersedeProjectDecision(input: {
  slug: string;
  originalId: string;
  originalExpectedHash: string;
  replacement: ProjectDecision;
}): { original: ProjectDecisionDocument; replacement: ProjectDecisionDocument } {
  const original = getProjectDecision(input.slug, input.originalId);
  if (!original) throw new Error(`Decision "${input.originalId}" was not found.`);
  if (original.hash !== input.originalExpectedHash) {
    throw new ContentConflictError(
      path.join(decisionDirectory(input.slug), original.fileName),
      input.originalExpectedHash,
      original.hash,
    );
  }
  if (original.decision.status !== "decided") {
    throw new Error("Only a decided record can be superseded.");
  }
  if (original.decision.superseded_by) {
    throw new Error(`Decision "${input.originalId}" is already superseded.`);
  }

  const replacement = projectDecisionSchema.parse(input.replacement);
  if (replacement.status !== "decided") {
    throw new Error("The replacement must be explicitly confirmed as decided.");
  }
  if (replacement.supersedes !== original.decision.id) {
    throw new Error("The replacement must identify the exact decision it supersedes.");
  }

  const created = createProjectDecision(input.slug, replacement);
  try {
    const updated = updateProjectDecision(
      input.slug,
      original.decision.id,
      {
        ...original.decision,
        status: "superseded",
        superseded_by: replacement.id,
      },
      input.originalExpectedHash,
    );
    return { original: updated, replacement: created };
  } catch (cause) {
    throw new DecisionSupersessionPartialError(created, cause);
  }
}
