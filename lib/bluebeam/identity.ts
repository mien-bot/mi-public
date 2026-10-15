import type { MarkupEntry } from "../schema";

/**
 * `markupEntrySchema` has no id field, so applying an import twice — or
 * applying two exports that both cover the same drawing — needs a
 * deterministic rule for "is this the same markup entry."
 *
 * Rule: a markup entry represents one markup/redline round for one sheet at
 * one revision, recorded in one file (see markups/originals + markups/redlines
 * and getMarkupResolution(), which treats each index.yaml entry as a single
 * resolvable unit, not an individual annotation). So identity is the
 * normalized triple (sheet, revision, file):
 *
 *   - `sheet` and `file` are trimmed, lowercased, and have backslashes
 *     normalized to forward slashes (Windows vs. exported-path differences
 *     shouldn't create a false "new" entry);
 *   - `revision` is compared numerically.
 *
 * `date`, `discipline`, `status`, `notes`, and `related_code_sections` are
 * NOT part of identity — a re-import of the same sheet/revision/file with a
 * changed status or notes is treated as an UPDATE to the existing entry, not
 * a new one. If a firm re-marks up the same revision in a second round using
 * a different redline file, that naturally produces a different `file` and
 * therefore a different identity (a new entry) — which is the desired
 * behavior, since it's a distinct markup round.
 */
export function normalizeIdentityPart(value: string): string {
  return value.trim().toLowerCase().replace(/\\/g, "/");
}

export function deriveIdentity(entry: Pick<MarkupEntry, "sheet" | "revision" | "file">): string {
  return [normalizeIdentityPart(entry.sheet), String(entry.revision), normalizeIdentityPart(entry.file)].join("::");
}
