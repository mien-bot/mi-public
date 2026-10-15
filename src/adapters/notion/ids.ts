const NOTION_ID_PATTERN = /^[a-f0-9]{32}$/i;

/**
 * Accepts UUIDs with or without dashes and current `collection://`
 * data-source URLs. Returns the compact identifier accepted by Notion API
 * database and data-source endpoints.
 */
export function normalizeNotionId(value: string, label = "Notion ID"): string {
  const compact = value
    .trim()
    .replace(/^collection:\/\//i, "")
    .replaceAll("-", "");
  if (!NOTION_ID_PATTERN.test(compact)) {
    throw new Error(`${label} must be a Notion UUID or collection:// data-source ID.`);
  }
  return compact.toLowerCase();
}

export function configuredNotionId(
  env: Readonly<Record<string, string | undefined>>,
  primaryKey: string,
  legacyKey: string,
): string | null {
  const value = env[primaryKey] ?? env[legacyKey];
  return value ? normalizeNotionId(value, primaryKey) : null;
}
