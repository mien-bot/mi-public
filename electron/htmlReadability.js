// Dependency-free HTML -> readable Markdown-ish text for electron/localFetch.js.
//
// Deliberately not a DOM parser. Mi only needs a public page's reading order, headings, lists,
// and links; adding a parser to the packaged Electron runtime costs more than it returns. What
// this misses degrades to plainer text, never to a silently wrong answer -- callers report the
// extracted character count so an empty or shell-only page is visible rather than inferred.

const REMOVED_ELEMENTS = [
  "script", "style", "noscript", "template", "svg", "canvas",
  "iframe", "object", "embed", "video", "audio",
];
const CHROME_ELEMENTS = ["nav", "footer", "aside", "form"];
const BLOCK_CLOSE = /<\/(?:p|div|section|article|main|header|footer|aside|nav|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|blockquote|pre|figure|figcaption|form|address)\s*>/gi;
const MAX_LINKS = 500;
/** Below this, a `<main>`/`<article>` is treated as a wrapper rather than the real content. */
const MAIN_REGION_MIN_CHARACTERS = 400;

const NAMED_ENTITIES = new Map(Object.entries({
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'",
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", shy: "",
  ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  laquo: "«", raquo: "»", bull: "•", middot: "·",
  copy: "©", reg: "®", trade: "™", deg: "°", sect: "§", para: "¶",
  times: "×", divide: "÷", plusmn: "±", minus: "−",
  frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³",
  euro: "€", pound: "£", yen: "¥", cent: "¢",
  dagger: "†", permil: "‰", prime: "′", Prime: "″",
  larr: "←", rarr: "→", harr: "↔",
}));

function decodeEntities(value) {
  return value.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES.get(entity);
    return named === undefined ? match : named;
  });
}

/** Collapses a fragment to a single line of readable text -- used for titles and link labels. */
function plainText(fragment) {
  return decodeEntities(String(fragment).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function removeElements(html, tags) {
  let result = html;
  for (const tag of tags) {
    result = result.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ");
    // Void or unclosed forms of the same element still shouldn't leak their attributes.
    result = result.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), " ");
  }
  return result;
}

function firstElementContent(html, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)<\\/${tag}\\s*>`, "i").exec(html);
  return match ? match[1] : null;
}

function absoluteUrl(href, baseUrl) {
  const trimmed = String(href).trim();
  if (!trimmed || /^(?:javascript|mailto|tel|data):/i.test(trimmed)) return null;
  try {
    const resolved = new URL(trimmed, baseUrl || undefined);
    return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.toString() : null;
  } catch {
    return null;
  }
}

const ANCHOR = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;

function collectLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  for (const match of html.matchAll(ANCHOR)) {
    const url = absoluteUrl(decodeEntities(match[1] ?? match[2] ?? match[3] ?? ""), baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, text: plainText(match[4]).slice(0, 300) });
    if (links.length >= MAX_LINKS) break;
  }
  return links;
}

function normalizeWhitespace(value) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toMarkdown(html, baseUrl) {
  return normalizeWhitespace(
    decodeEntities(
      html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
        .replace(/<h([1-6])\b[^>]*>/gi, (_match, level) => `\n\n${"#".repeat(Number(level))} `)
        .replace(/<\/h[1-6]\s*>/gi, "\n\n")
        .replace(/<li\b[^>]*>/gi, "\n- ")
        .replace(/<\/(?:td|th)\s*>/gi, " | ")
        // Anchors become Markdown before the generic tag strip, so their targets survive.
        .replace(ANCHOR, (_match, doubleQuoted, singleQuoted, bare, inner) => {
          const label = plainText(inner);
          if (!label) return " ";
          const url = absoluteUrl(decodeEntities(doubleQuoted ?? singleQuoted ?? bare ?? ""), baseUrl);
          return url ? `[${label}](${url})` : label;
        })
        .replace(BLOCK_CLOSE, "\n")
        .replace(/<[^>]*>/g, " "),
    ),
  );
}

/**
 * Extracts a page's title, readable Markdown-ish text, and absolute links.
 * `baseUrl` is the response's final URL so relative hrefs resolve the way a browser would.
 */
function htmlToReadableText(html, baseUrl) {
  const source = String(html ?? "").replace(/<!--[\s\S]*?-->/g, " ");
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source);

  let body = removeElements(source, REMOVED_ELEMENTS);
  const bodyContent = firstElementContent(body, "body");
  if (bodyContent !== null) body = bodyContent;

  const main = firstElementContent(body, "main") ?? firstElementContent(body, "article");
  const region = main !== null && plainText(main).length >= MAIN_REGION_MIN_CHARACTERS
    ? main
    : removeElements(body, CHROME_ELEMENTS);

  return {
    title: titleMatch ? plainText(titleMatch[1]) : "",
    text: toMarkdown(region, baseUrl),
    links: collectLinks(region, baseUrl),
  };
}

module.exports = {
  absoluteUrl,
  collectLinks,
  decodeEntities,
  htmlToReadableText,
  plainText,
  toMarkdown,
};
