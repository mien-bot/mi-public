const NOTION_HOSTS = new Set([
  "notion.so",
  "www.notion.so",
  "notion.com",
  "www.notion.com",
  "app.notion.com",
]);

function normalizePageId(value) {
  if (typeof value !== "string") return null;
  const compact = value.trim().replaceAll("-", "");
  return /^[a-f0-9]{32}$/i.test(compact) ? compact.toLowerCase() : null;
}

function validateNotionTarget(value) {
  const pageId = normalizePageId(value);
  if (pageId) return `https://www.notion.so/${pageId}`;
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !NOTION_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function toNotionDeepLink(httpsUrl) {
  const validated = validateNotionTarget(httpsUrl);
  if (!validated) return null;
  const url = new URL(validated);
  return `notion://${url.host}${url.pathname}${url.search}${url.hash}`;
}

module.exports = { normalizePageId, validateNotionTarget, toNotionDeepLink };
