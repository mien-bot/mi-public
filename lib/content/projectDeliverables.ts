import path from "node:path";
import { dump as dumpYaml } from "js-yaml";
import {
  projectDeliverableIndexSchema,
  projectDeliverableSchema,
  type ProjectDeliverable,
} from "@/lib/schema";
import { readCurrentHash, writeFileAtomically, type AtomicWriteOptions } from "./atomicContentWrite";
import { readYamlFileIfExists } from "./fsUtils";
import { contentDir } from "./projects";

export function projectDeliverablesPath(slug: string): string {
  return path.join(contentDir(slug), "deliverables", "index.yaml");
}

/**
 * Newest issued package first. Entries with no confirmed date sort last rather than being
 * guessed into an order -- an undated draft is exactly the thing someone needs to notice.
 */
function byIssuedDateDescending(left: ProjectDeliverable, right: ProjectDeliverable): number {
  if (left.issued_date === right.issued_date) return left.id.localeCompare(right.id);
  if (!left.issued_date) return 1;
  if (!right.issued_date) return -1;
  return right.issued_date.localeCompare(left.issued_date);
}

export function getProjectDeliverables(slug: string): ProjectDeliverable[] {
  const entries = readYamlFileIfExists(
    projectDeliverablesPath(slug),
    (data) => projectDeliverableIndexSchema.parse(data ?? []),
    [],
  );
  return [...entries].sort(byIssuedDateDescending);
}

export interface ProjectDeliverablesWithHash {
  deliverables: ProjectDeliverable[];
  hash: string | null;
}

/**
 * Read the hash alongside the entries so a confirm can prove nothing else landed in between --
 * the register is one file, so two edits to different deliverables still collide.
 */
export function getProjectDeliverablesWithHash(slug: string): ProjectDeliverablesWithHash {
  return {
    deliverables: getProjectDeliverables(slug),
    hash: readCurrentHash(projectDeliverablesPath(slug)),
  };
}

export function writeProjectDeliverables(
  slug: string,
  entries: ProjectDeliverable[],
  options: AtomicWriteOptions = {},
): void {
  const parsed = projectDeliverableIndexSchema.parse(entries);
  writeFileAtomically(
    projectDeliverablesPath(slug),
    parsed.length === 0 ? "[]\n" : dumpYaml(parsed, { lineWidth: 100, noRefs: true }),
    options,
  );
}

export function createProjectDeliverable(
  slug: string,
  input: ProjectDeliverable,
  expectedHash: string | null,
): ProjectDeliverable {
  const deliverable = projectDeliverableSchema.parse(input);
  const current = getProjectDeliverables(slug);
  if (current.some((entry) => entry.id === deliverable.id)) {
    throw new Error(`Deliverable "${deliverable.id}" already exists.`);
  }
  writeProjectDeliverables(slug, [...current, deliverable], { expectedHash });
  return deliverable;
}

/**
 * Removes a deliverable from the register.
 *
 * The register is one YAML array in a single file, so "delete" is a filter plus an atomic
 * rewrite guarded by the file's hash — the same optimistic-concurrency discipline the
 * create and update paths use. There is no per-record file to back up here; the previous
 * revision of the whole file is what writeFileAtomically already preserves.
 */
export function deleteProjectDeliverable(
  slug: string,
  id: string,
  expectedHash: string | null,
): ProjectDeliverable {
  const current = getProjectDeliverables(slug);
  const existing = current.find((entry) => entry.id === id);
  if (!existing) throw new Error(`Deliverable "${id}" was not found.`);
  writeProjectDeliverables(slug, current.filter((entry) => entry.id !== id), { expectedHash });
  return existing;
}

export function updateProjectDeliverable(
  slug: string,
  id: string,
  input: ProjectDeliverable,
  expectedHash: string | null,
): ProjectDeliverable {
  const deliverable = projectDeliverableSchema.parse(input);
  if (deliverable.id !== id) throw new Error("A deliverable's id cannot be changed.");
  const current = getProjectDeliverables(slug);
  if (!current.some((entry) => entry.id === id)) {
    throw new Error(`Deliverable "${id}" was not found.`);
  }
  writeProjectDeliverables(
    slug,
    current.map((entry) => (entry.id === id ? deliverable : entry)),
    { expectedHash },
  );
  return deliverable;
}
