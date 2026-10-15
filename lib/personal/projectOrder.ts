import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomically } from "@/lib/content/atomicContentWrite";
import { personalDataRoot, type PersonalStoreOptions } from "./store";

/**
 * A person's own preferred order for the project list. This lives beside the other personal
 * records (always a local path -- electron/desktopMain.js pins MI_PERSONAL_DATA_ROOT under the
 * per-user data folder, never the shared Dropbox root), because two partners dragging the same
 * list into different orders is a preference, not a disagreement about firm data.
 *
 * Stored as slugs only. A slug that no longer exists is ignored on read rather than pruned on
 * write, so temporarily unavailable content (an unsynced Dropbox folder) never silently drops
 * someone's arrangement.
 */
const projectOrderSchema = z.object({
  schemaVersion: z.literal(1),
  /** Ordered project slugs. Anything absent is unordered and sorts after these. */
  slugs: z.array(z.string().min(1)),
  updatedAt: z.string(),
});

export type ProjectOrder = z.infer<typeof projectOrderSchema>;

export function projectOrderPath(options: PersonalStoreOptions = {}): string {
  return path.join(personalDataRoot(options), "project-order.json");
}

function empty(): ProjectOrder {
  return { schemaVersion: 1, slugs: [], updatedAt: new Date().toISOString() };
}

/** Never throws: an unreadable or malformed file means "no personal order yet", not an error. */
export function readProjectOrder(options: PersonalStoreOptions = {}): ProjectOrder {
  const filePath = projectOrderPath(options);
  if (!fs.existsSync(filePath)) return empty();
  try {
    const parsed = projectOrderSchema.safeParse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
    if (!parsed.success) return empty();
    // Duplicates would make a slug's position ambiguous; first occurrence wins.
    const seen = new Set<string>();
    return { ...parsed.data, slugs: parsed.data.slugs.filter((slug) => !seen.has(slug) && seen.add(slug)) };
  } catch {
    return empty();
  }
}

export function writeProjectOrder(
  slugs: string[],
  options: PersonalStoreOptions = {},
): ProjectOrder {
  const seen = new Set<string>();
  const next: ProjectOrder = {
    schemaVersion: 1,
    slugs: slugs.filter((slug) => typeof slug === "string" && slug.length > 0 && !seen.has(slug) && seen.add(slug)),
    updatedAt: new Date().toISOString(),
  };
  const filePath = projectOrderPath(options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileAtomically(filePath, `${JSON.stringify(projectOrderSchema.parse(next), null, 2)}\n`);
  return next;
}

/**
 * Ranks by saved position, with everything unranked after it. Callers keep their own tiebreak
 * for the unranked tail so a fresh install still gets a stable, meaningful list.
 */
export function projectOrderRank(order: Pick<ProjectOrder, "slugs">): (slug: string) => number {
  const positions = new Map(order.slugs.map((slug, index) => [slug, index]));
  return (slug) => positions.get(slug) ?? Number.MAX_SAFE_INTEGER;
}
