/**
 * A project record that a person confirmed was replaced by another one, through
 * terminal_project_slug. It stays on disk with its Notion link, but it is not a second project:
 * lists leave it out and opening it goes to the current record. Nothing here infers identity
 * from names, paths, or Notion ids.
 */
export function isCurrentProject(project: { meta: { terminal_project_slug?: string | null } }): boolean {
  return !project.meta.terminal_project_slug;
}

/** Follows the confirmed links. A missing target or a cycle leaves the record where it is. */
export function resolveCurrentProjectSlug(
  slug: string,
  next: (slug: string) => string | null | undefined,
): string {
  const seen = new Set([slug]);
  let current = slug;
  for (;;) {
    const target = next(current);
    if (!target) return current;
    if (seen.has(target)) return slug;
    seen.add(target);
    current = target;
  }
}
