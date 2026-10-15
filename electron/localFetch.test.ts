import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  clearLocalFetchCaches,
  fetchLocalUrl,
  isPrivateAddress,
  normalizeUrl,
  parseRobots,
  robotsAllowsPath,
} = require("./localFetch");

const ROBOTS_URL = "https://www.chicago.gov/robots.txt";
const PAGE_URL = "https://www.chicago.gov/sbif";
const OPEN_ROBOTS = "User-agent: *\nDisallow: /private\n";
const ARTICLE = `<html><head><title>SBIF</title></head><body><main><h1>Small Business Improvement Fund</h1>
  <p>Grants cover eligible work. ${"Program detail sentence. ".repeat(30)}</p></main></body></html>`;
const SHELL = `<html><head><title>SBIF</title></head><body><div id="root"></div><script>boot()</script></body></html>`;
const RENDERED = `<html><head><title>SBIF</title></head><body><main><h1>Rendered heading</h1>
  <p>${"Rendered body sentence. ".repeat(30)}</p></main></body></html>`;

function httpResponse({
  status = 200,
  url,
  contentType = "text/html; charset=utf-8",
  body = "",
}: { status?: number; url: string; contentType?: string; body?: string }) {
  const bytes = Buffer.from(body, "utf8");
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    body: null,
    arrayBuffer: async () => bytes,
  };
}

function routedFetch(routes: Record<string, ReturnType<typeof httpResponse>>) {
  return vi.fn(async (url: string) => {
    const response = routes[url];
    if (!response) throw new Error(`Unexpected fetch: ${url}`);
    return response;
  });
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    hostIntervalMs: 0,
    findBrowser: () => ({ name: "Google Chrome", executable: "chrome.exe" }),
    render: vi.fn(async () => RENDERED),
    now: () => new Date("2026-08-06T12:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  clearLocalFetchCaches();
});

describe("URL and address guards", () => {
  it("accepts public http and https URLs and strips the fragment", () => {
    expect(normalizeUrl("https://www.chicago.gov/sbif#apply").toString()).toBe("https://www.chicago.gov/sbif");
  });

  it("refuses non-web schemes, embedded credentials, and local hosts", () => {
    expect(() => normalizeUrl("ftp://example.org/file")).toThrow(/http and https/i);
    expect(() => normalizeUrl("https://user:secret@example.org/")).toThrow(/never sends credentials/i);
    expect(() => normalizeUrl("http://localhost:3000/api")).toThrow(/public pages only/i);
    expect(() => normalizeUrl("http://printer.local/status")).toThrow(/public pages only/i);
    expect(() => normalizeUrl("   ")).toThrow(/one http or https URL/i);
  });

  it("classifies private, loopback, and link-local addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.9.9", "169.254.1.1", "::1", "fd00::1", "fe80::1"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["93.184.216.34", "8.8.8.8", "2606:2800:220:1::"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it("refuses a public hostname that resolves to a private address", async () => {
    await expect(fetchLocalUrl({
      url: PAGE_URL,
      fetchImpl: routedFetch({}),
      ...deps({ lookup: async () => [{ address: "127.0.0.1", family: 4 }] }),
    })).rejects.toThrow(/private or unroutable/i);
  });
});

describe("robots.txt", () => {
  it("groups rules by user-agent and applies the longest matching path", () => {
    const groups = parseRobots(`
      # comment
      User-agent: *
      Disallow: /private
      Allow: /private/public-notice

      User-agent: badbot
      Disallow: /
    `);
    expect(robotsAllowsPath(groups, "mi", "/sbif")).toBe(true);
    expect(robotsAllowsPath(groups, "mi", "/private/manual.pdf")).toBe(false);
    expect(robotsAllowsPath(groups, "mi", "/private/public-notice")).toBe(true);
    expect(robotsAllowsPath(groups, "badbot", "/sbif")).toBe(false);
  });

  it("treats an empty Disallow as permission rather than a blanket block", () => {
    expect(robotsAllowsPath(parseRobots("User-agent: *\nDisallow:"), "mi", "/anything")).toBe(true);
  });

  it("refuses a disallowed path without requesting the page", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: "User-agent: *\nDisallow: /sbif\n" }),
    });
    await expect(fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...deps() })).rejects.toThrow(/robots\.txt disallows/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("proceeds when robots.txt is missing and records that in the result", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, status: 404 }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, body: ARTICLE }),
    });
    const result = await fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...deps() });
    expect(result.robots.allowed).toBe(true);
    expect(result.robots.note).toMatch(/No usable robots\.txt \(HTTP 404\)/);
  });
});

describe("tier 1", () => {
  it("returns extracted text with the provenance an agent needs to date-stamp a fact", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, body: ARTICLE }),
    });
    const result = await fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...deps() });

    expect(result.tier).toBe("http");
    expect(result.status).toBe(200);
    expect(result.final_url).toBe(PAGE_URL);
    expect(result.content_type).toContain("text/html");
    expect(result.retrieved_at).toBe("2026-08-06T12:00:00.000Z");
    expect(result.title).toBe("SBIF");
    expect(result.text).toContain("# Small Business Improvement Fund");
    expect(result.from_cache).toBe(false);
    expect(result.warnings[0]).toMatch(/untrusted evidence/i);
    expect(result.tier_notes).toContain("Tier 1 (local HTTP client) returned 200.");
  });

  it("sends browser-like headers and no credentials", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, body: ARTICLE }),
    });
    await fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...deps() });
    const [, init] = fetchImpl.mock.calls[1];
    expect(init.headers["User-Agent"]).toMatch(/Chrome\//);
    expect(init.headers["Accept-Language"]).toBe("en-US,en;q=0.9");
    expect(Object.keys(init.headers)).not.toContain("Cookie");
    expect(Object.keys(init.headers)).not.toContain("Authorization");
  });

  it("reports the final URL after redirects", async () => {
    const finalUrl = "https://www.chicago.gov/city/en/depts/dcd/sbif.html";
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: finalUrl, body: ARTICLE }),
    });
    const result = await fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...deps() });
    expect(result.final_url).toBe(finalUrl);
  });

  it("routes a PDF response through extraction instead of returning binary", async () => {
    const extractPdf = vi.fn(async () => ({
      source: { name: PAGE_URL, bytes: 4 },
      summary: { page_count: 2, pages_without_text: 1 },
      metadata: { Title: "SBIF Program Manual" },
      warnings: ["1 page(s) have no readable text layer and may require OCR or visual review."],
      pages: [
        { page: 1, text: "Eligible work includes facade repair.", links: [{ url: "https://somercor.com/sbif", destination: null }] },
        { page: 2, text: "", links: [] },
      ],
    }));
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, contentType: "application/pdf", body: "%PDF" }),
    });

    const result = await fetchLocalUrl({ url: PAGE_URL, fetchImpl, extractPdf, ...deps() });
    expect(extractPdf).toHaveBeenCalledOnce();
    expect(result.kind).toBe("pdf");
    expect(result.title).toBe("SBIF Program Manual");
    expect(result.text).toContain("## Page 1");
    expect(result.text).toContain("Eligible work includes facade repair.");
    expect(result.pdf.summary.page_count).toBe(2);
    expect(result.links).toContainEqual({ url: "https://somercor.com/sbif", text: "Page 1" });
    expect(result.warnings).toContain("1 page(s) have no readable text layer and may require OCR or visual review.");
  });
});

describe("tier 2 escalation", () => {
  it("renders locally when tier 1 is rejected with 403", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, status: 403, body: "Forbidden" }),
    });
    const dependencies = deps();
    const result = await fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...dependencies });

    expect(dependencies.render).toHaveBeenCalledOnce();
    expect(result.tier).toBe("browser");
    expect(result.browser).toBe("Google Chrome");
    expect(result.text).toContain("# Rendered heading");
    expect(result.tier_notes[0]).toBe("Tier 1 (local HTTP client) returned 403.");
    expect(result.tier_notes[1]).toMatch(/Tier 2 rendered the page with local Google Chrome/);
  });

  it("renders locally when tier 1 returns a JavaScript shell", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, body: SHELL }),
    });
    const dependencies = deps();
    const result = await fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...dependencies });

    expect(dependencies.render).toHaveBeenCalledOnce();
    expect(result.tier).toBe("browser");
    expect(result.tier_notes[1]).toMatch(/extracted only 0 characters/);
  });

  it("attributes no HTTP status to rendered content", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, status: 403, body: "Forbidden" }),
    });
    const result = await fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...deps() });
    expect(result.status).toBeNull();
    expect(result.warnings.some((warning: string) => /no HTTP status code/.test(warning))).toBe(true);
  });

  it("warns loudly that a rendered 4xx may be the site's error page, not the document", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, status: 404, body: "Not found" }),
    });
    const result = await fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...deps() });

    expect(result.tier).toBe("browser");
    expect(result.warnings[0]).toMatch(/Tier 1 returned HTTP 404.*error or "not found" page/s);
    expect(result.tier_notes.at(-1)).toMatch(/Tier 1 returned HTTP 404/);
  });

  it("does not add the error-page warning when tier 1 merely returned an empty shell", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, body: SHELL }),
    });
    const result = await fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...deps() });
    expect(result.warnings.some((warning: string) => /error or "not found" page/.test(warning))).toBe(false);
  });

  it("never escalates in http mode and says how to render instead", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, status: 403, body: "Forbidden" }),
    });
    const dependencies = deps();
    await expect(fetchLocalUrl({ url: PAGE_URL, mode: "http", fetchImpl, ...dependencies }))
      .rejects.toThrow(/HTTP 403.*mode "auto"/s);
    expect(dependencies.render).not.toHaveBeenCalled();
  });

  it("skips tier 1 entirely in browser mode", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
    });
    const result = await fetchLocalUrl({ url: PAGE_URL, mode: "browser", fetchImpl, ...deps() });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.tier).toBe("browser");
  });

  it("explains what to install when no local browser exists", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, status: 403, body: "Forbidden" }),
    });
    await expect(fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...deps({ findBrowser: () => null }) }))
      .rejects.toThrow(/no local Chrome or Edge.*MI_HEADLESS_BROWSER/s);
  });

  it("rejects an unknown mode", async () => {
    await expect(fetchLocalUrl({ url: PAGE_URL, mode: "sideways" })).rejects.toThrow(/auto, http, or browser/i);
  });
});

describe("caching", () => {
  it("serves a repeated read from cache and marks it, so a stale timestamp is never hidden", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, body: ARTICLE }),
    });
    const dependencies = deps();
    const first = await fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...dependencies });
    const second = await fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...dependencies });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(first.from_cache).toBe(false);
    expect(second.from_cache).toBe(true);
    expect(second.retrieved_at).toBe(first.retrieved_at);
  });

  it("re-reads the page when refresh is requested", async () => {
    const fetchImpl = routedFetch({
      [ROBOTS_URL]: httpResponse({ url: ROBOTS_URL, contentType: "text/plain", body: OPEN_ROBOTS }),
      [PAGE_URL]: httpResponse({ url: PAGE_URL, body: ARTICLE }),
    });
    const dependencies = deps();
    await fetchLocalUrl({ url: PAGE_URL, fetchImpl, ...dependencies });
    const refreshed = await fetchLocalUrl({ url: PAGE_URL, refresh: true, fetchImpl, ...dependencies });

    expect(refreshed.from_cache).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
