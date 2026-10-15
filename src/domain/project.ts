/** Normalized domain view of a project, independent of which system (repo/Notion) it came from. */
export interface Project {
  slug: string;
  name: string;
  status: string;
  notionPageId: string | null;
  dropboxPath: string | null;
}

export interface ProjectNameMatch {
  id: string;
  name: string;
  score: number;
}

/**
 * Splits camelCase/PascalCase and letter-digit boundaries into separate
 * words before tokenizing — real Dropbox folder names are often glued
 * together this way (e.g. "SampleCafe", "SampleStudio", "08_SampleRetail-1102-HVAC")
 * while Notion page titles are space-separated ("Sample Cafe"). Without
 * this, "SampleCafe" stays one token that never overlaps "sample"+"coffee".
 */
function splitWordBoundaries(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2");
}

function normalize(name: string): string {
  return splitWordBoundaries(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Simple, dependency-free scorer for matching a project slug/name against
 * candidate names (Notion Studio Projects page titles, real Dropbox folder
 * names, ...) — no fuzzy-matching library needed at ~20 projects. Token-
 * overlap ratio plus a substring bonus; ranked descending, caller still
 * requires human confirmation before linking (never auto-apply the top
 * match — see notionLink.ts/suggest-dropbox-links.ts).
 */
export function matchProjectName(
  name: string,
  candidates: { id: string; name: string }[],
): ProjectNameMatch[] {
  const queryTokens = new Set(normalize(name).split(" ").filter(Boolean));
  const normalizedQuery = normalize(name);

  return candidates
    .map((candidate) => {
      const candidateNormalized = normalize(candidate.name);
      const candidateTokens = new Set(candidateNormalized.split(" ").filter(Boolean));
      const overlap = [...queryTokens].filter((t) => candidateTokens.has(t)).length;
      const union = new Set([...queryTokens, ...candidateTokens]).size || 1;
      let score = overlap / union;
      if (candidateNormalized.includes(normalizedQuery) || normalizedQuery.includes(candidateNormalized)) {
        score += 0.5;
      }
      return { id: candidate.id, name: candidate.name, score };
    })
    .sort((a, b) => b.score - a.score);
}
