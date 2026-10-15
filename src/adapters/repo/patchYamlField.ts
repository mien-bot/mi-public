import fs from "node:fs";
import { hashContent, writeFileAtomically } from "@/lib/content/atomicContentWrite";

/**
 * Replaces (or appends) a single top-level `field: value` line in a YAML
 * file via targeted text substitution — never a full js-yaml dump. A dump
 * would strip hand-written comments real project files carry (e.g. the
 * dropbox_path explainer in project.yaml), so this only touches the one
 * line it's asked to. Only safe for flat scalar top-level fields (exactly
 * what notion_page_id/status are) — not for nested/array fields.
 */
export function patchScalarField(filePath: string, field: string, value: string): void {
  patchScalarFields(filePath, { [field]: value });
}

/**
 * Applies multiple flat scalar changes in one compare-before-write operation.
 * `expectedHash` lets callers protect the version read before a slow external fetch.
 */
export function patchScalarFields(
  filePath: string,
  fields: Record<string, string>,
  expectedHash?: string | null,
): void {
  const raw = fs.readFileSync(filePath, "utf-8");
  let updated = raw;
  for (const [field, value] of Object.entries(fields)) {
    const pattern = new RegExp(`^${field}:.*$`, "m");
    const line = `${field}: ${value}`;
    updated = pattern.test(updated)
      ? updated.replace(pattern, line)
      : `${updated.trimEnd()}\n${line}\n`;
  }
  if (updated === raw) return;
  writeFileAtomically(filePath, updated, {
    expectedHash: expectedHash === undefined ? hashContent(raw) : expectedHash,
  });
}
